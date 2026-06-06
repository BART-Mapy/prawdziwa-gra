"""Pobiera siedziby gmin z OSM – nazwa gminy ma pierwszeństwo przed losową wsią."""
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

BASE = Path(__file__).parent
CACHE = BASE / "data" / "osm_miejscowosci.json"
EXPORT = BASE / "export.geojson"
OUT = BASE / "siedziby.geojson"
PAIRS = BASE / "data" / "gminy_wiejskie_z_miastem.json"
GMINY = BASE / "data" / "gminy.geojson"
OVERPASS = "https://overpass-api.de/api/interpreter"

# Wszystkie miejscowości (z ludnością lub bez) – siedziba = po nazwie gminy
QUERY = """
[out:json][timeout:600];
area["ISO3166-1"="PL"]->.pl;
node["place"~"^(city|town|village)$"]["name"](area.pl);
out body;
"""


def log(msg):
    print(msg, flush=True)


def fetch_osm():
    if CACHE.exists():
        log(f"Cache: {CACHE}")
        with CACHE.open(encoding="utf-8") as f:
            return json.load(f)

    log("Pobieram z Overpass (~1–3 min)...")
    data = urllib.parse.urlencode({"data": QUERY}).encode("utf-8")
    req = urllib.request.Request(OVERPASS, data=data, method="POST")
    req.add_header("User-Agent", "prawdziwa-gra-map/1.0")
    with urllib.request.urlopen(req, timeout=360) as resp:
        raw = json.loads(resp.read().decode("utf-8"))

    CACHE.parent.mkdir(exist_ok=True)
    with CACHE.open("w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False)
    log(f"Zapisano cache: {CACHE}")
    return raw


def norm(name: str) -> str:
    s = (name or "").strip().lower()
    return re.sub(r"^(gmina|m\.)\s+", "", s)


def parse_pop(v) -> int:
    try:
        return int(str(v or "0").replace(" ", "").replace("\u00a0", ""))
    except ValueError:
        return 0


def osm_to_places(osm):
    places = []
    for el in osm.get("elements", []):
        if el["type"] != "node":
            continue
        tags = el.get("tags") or {}
        name = tags.get("name:pl") or tags.get("name")
        if not name:
            continue
        places.append({
            "name": name,
            "pop": parse_pop(tags.get("population")),
            "place": tags.get("place", ""),
            "teryt": tags.get("teryt:terc", ""),
            "lon": el["lon"],
            "lat": el["lat"],
            "tags": tags,
        })
    return places


def export_city_hint(p):
    hints = []
    old = p.get("old_name") or ""
    for part in old.split(";"):
        n = norm(part)
        if n:
            hints.append(n)
    src = p.get("source:population") or ""
    m = re.search(r"gmina_([A-Za-z0-9_]+)", src)
    if m:
        hints.append(norm(m.group(1).replace("_", " ")))
    return hints


def load_export_pop():
    if not EXPORT.exists():
        return {}
    with EXPORT.open(encoding="utf-8") as f:
        data = json.load(f)
    by_kod = {}
    for feat in data["features"]:
        p = feat["properties"]
        kod = p.get("teryt:terc")
        if not kod:
            continue
        by_kod[kod] = {
            "pop": parse_pop(p.get("population")),
            "name": p.get("name:pl") or p.get("name") or "",
            "lon": feat["geometry"]["coordinates"][0],
            "lat": feat["geometry"]["coordinates"][1],
            "city_hints": export_city_hint(p),
        }
    return by_kod


def find_city_for_rural(kod, gn, city_by_pow_name, city_by_woj_name, export_by_kod):
    city = city_by_pow_name.get((powiat_key(kod), gn))
    if city:
        return city, "powiat"
    city = city_by_woj_name.get((woj_key(kod), gn))
    if city:
        return city, "wojewodztwo"
    exp = export_by_kod.get(kod)
    if not exp:
        return None, ""
    for hint in exp["city_hints"]:
        if not hint or hint == gn:
            continue
        city = city_by_pow_name.get((powiat_key(kod), hint))
        if city:
            return city, "export_hint_powiat"
        city = city_by_woj_name.get((woj_key(kod), hint))
        if city:
            return city, "export_hint_wojewodztwo"
    return None, ""


def pick_seat(gmin_feat, places, tree, geoms):
    gpoly = shape(gmin_feat["geometry"])
    kod = gmin_feat["properties"]["kod"]
    kod6 = kod[:6]
    gn = norm(gmin_feat["properties"]["nazwa"])

    candidates = []
    for idx in tree.query(gpoly):
        if gpoly.contains(geoms[idx]):
            candidates.append(places[idx])

    if not candidates:
        for p in places:
            if p["teryt"][:6] == kod6:
                candidates.append(p)
        if not candidates:
            return None

    def rank(p):
        name_ok = norm(p["name"]) == gn
        return (
            1000 if name_ok else 0,
            10 if p["teryt"][:6] == kod6 else 0,
            {"city": 3, "town": 2, "village": 1}.get(p["place"], 0),
            p["pop"],
        )

    return max(candidates, key=rank)


def resolve_pop(seat, gmin_feat, candidates, export_by_kod, kod_override=None):
    if seat["pop"]:
        return seat["pop"]

    gn = norm(gmin_feat["properties"]["nazwa"])
    for p in candidates:
        if norm(p["name"]) == gn and p["pop"]:
            return p["pop"]

    kod = kod_override or gmin_feat["properties"]["kod"]
    exp = export_by_kod.get(kod)
    if exp and norm(exp["name"]) == gn and exp["pop"]:
        return exp["pop"]

    return 0


def gmin_kind(kod: str) -> str:
    return kod[-1] if len(kod) >= 7 else ""


def is_gmina_miejska(kod: str) -> bool:
    return gmin_kind(kod) == "1"


def is_gmina_wiejska(kod: str) -> bool:
    return gmin_kind(kod) == "2"


def is_gmina_miejsko_wiejska(kod: str) -> bool:
    return gmin_kind(kod) == "3"


def powiat_key(kod: str) -> str:
    return kod[:4]


def woj_key(kod: str) -> str:
    return kod[:2]


def main():
    osm = fetch_osm()
    places = osm_to_places(osm)
    with_pop = sum(1 for p in places if p["pop"])
    log(f"Miejscowości OSM: {len(places)} (z populacją: {with_pop})")

    export_by_kod = load_export_pop()
    with GMINY.open(encoding="utf-8") as f:
        gminy = json.load(f)

    tree, geoms = build_spatial_index(places)
    missing = []
    prepared = {}

    for i, gf in enumerate(gminy["features"]):
        if i and i % 500 == 0:
            log(f"  ... {i}/{len(gminy['features'])}")
        kod = gf["properties"]["kod"]
        gpoly = shape(gf["geometry"])
        inside = [p for idx in tree.query(gpoly) if gpoly.contains(geoms[idx]) for p in [places[idx]]]
        seat = pick_seat(gf, places, tree, geoms)
        if not seat:
            missing.append(gf["properties"]["nazwa"])
            continue

        pop = resolve_pop(seat, gf, inside, export_by_kod)
        prepared[kod] = {
            "gf": gf,
            "seat": seat,
            "pop": pop,
            "inside": inside,
            "linked_city": False,
            "city_gmina_kod": "",
            "link_via": "",
        }

    city_by_pow_name = {}
    city_by_woj_name = {}
    for kod, item in prepared.items():
        if not is_gmina_miejska(kod):
            continue
        gn = norm(item["gf"]["properties"]["nazwa"])
        city_by_pow_name[(powiat_key(kod), gn)] = item
        wkey = (woj_key(kod), gn)
        if wkey not in city_by_woj_name or item["pop"] > city_by_woj_name[wkey]["pop"]:
            city_by_woj_name[wkey] = item

    linked = 0
    for kod, item in prepared.items():
        if not is_gmina_wiejska(kod):
            continue
        gn = norm(item["gf"]["properties"]["nazwa"])
        city, link_via = find_city_for_rural(kod, gn, city_by_pow_name, city_by_woj_name, export_by_kod)
        if not city:
            continue
        city_kod = city["gf"]["properties"]["kod"]
        city_pop = resolve_pop(city["seat"], city["gf"], city["inside"], export_by_kod, city_kod)
        item["seat"] = city["seat"]
        item["pop"] = city_pop or city["pop"]
        item["linked_city"] = True
        item["city_gmina_kod"] = city_kod
        item["link_via"] = link_via
        linked += 1

    pairs = []
    features = []
    for kod, item in prepared.items():
        seat = item["seat"]
        gf = item["gf"]
        exp = export_by_kod.get(kod)
        gmina_pop = exp["pop"] if exp and exp.get("pop") else 0
        kind = gmin_kind(kod)
        if item["linked_city"]:
            city_exp = export_by_kod.get(item["city_gmina_kod"])
            seat_pop = city_exp["pop"] if city_exp and city_exp.get("pop") else item["pop"]
        elif kind in ("2", "3"):
            seat_pop = item["pop"]
        else:
            seat_pop = gmina_pop or item["pop"]
        tags = dict(seat["tags"])
        if item["linked_city"]:
            city_nazwa = prepared[item["city_gmina_kod"]]["gf"]["properties"]["nazwa"]
            tags["name"] = city_nazwa
            tags["city_nazwa"] = city_nazwa
        else:
            tags["name"] = seat["name"]
        tags["name:pl"] = tags["name"]
        tags["gmina_population"] = str(gmina_pop) if gmina_pop else ""
        tags["seat_population"] = str(seat_pop) if seat_pop else ""
        tags["population"] = str(gmina_pop) if gmina_pop else ""
        tags["population_source"] = "export.geojson" if gmina_pop else tags.get("source", "overpass-osm")
        tags["source"] = "city-gmina-linked" if item["linked_city"] else "overpass-osm"
        tags["gmina_kod"] = kod
        tags["gmina_nazwa"] = gf["properties"]["nazwa"]
        if item["linked_city"]:
            tags["rural_city_linked"] = "1"
            tags["city_gmina_kod"] = item["city_gmina_kod"]
            tags["link_via"] = item["link_via"]
            pairs.append({
                "nazwa": gf["properties"]["nazwa"],
                "miasto": prepared[item["city_gmina_kod"]]["gf"]["properties"]["nazwa"],
                "gmina_wiejska_kod": kod,
                "gmina_miejska_kod": item["city_gmina_kod"],
                "miasto_populacja": seat_pop,
                "link_via": item["link_via"],
                "wspolrzedne": [seat["lon"], seat["lat"]],
            })
        features.append({
            "type": "Feature",
            "properties": tags,
            "geometry": {"type": "Point", "coordinates": [seat["lon"], seat["lat"]]},
        })

    log(f"Gminy wiejskie -> siedziba w miescie: {linked}")
    PAIRS.parent.mkdir(exist_ok=True)
    with PAIRS.open("w", encoding="utf-8") as f:
        json.dump({
            "opis": "Gmina wiejska (TERYT ...2) + gmina miejska (...1) o tej samej nazwie",
            "reguly": [
                "gmina wiejska: kod TERYT konczy sie na 2",
                "gmina miejska: kod TERYT konczy sie na 1",
                "ta sama nazwa (bez prefiksu 'gmina')",
                "najpierw szukaj w powiecie (kod[:4]), potem w wojewodztwie (kod[:2])",
                "gmina przemianowana: export old_name lub URL populacji (np. gmina Slupsk -> Redzikowo)",
                "wspolrzedne i populacja miasta z OSM gminy miejskiej – bez wymyslania",
            ],
            "pary": sorted(pairs, key=lambda x: x["nazwa"]),
        }, f, ensure_ascii=False, indent=2)
    log(f"Lista par: {PAIRS}")
    log(f"Siedzib: {len(features)} / {len(gminy['features'])}")
    log(f"Bez dopasowania: {len(missing)}")
    if missing:
        log(f"Przykłady: {', '.join(missing[:8])}")

    tmp = OUT.with_suffix(".geojson.tmp")
    out = {
        "type": "FeatureCollection",
        "generator": "fetch_siedziby.py",
        "copyright": "OpenStreetMap contributors, ODbL",
        "features": features,
    }
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    try:
        tmp.replace(OUT)
        log(f"OK: {OUT}")
    except OSError:
        log(f"Plik zajęty – zapisano: {tmp}")


def build_spatial_index(places):
    geoms = [Point(p["lon"], p["lat"]) for p in places]
    return STRtree(geoms), geoms


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"BŁĄD: {e}")
        sys.exit(1)
