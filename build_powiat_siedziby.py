"""Buduje mapę oficjalnych siedzib powiatów."""
import json
import re
import unicodedata
from pathlib import Path

from shapely.geometry import Point, shape

BASE = Path(__file__).parent
POWIATY = BASE / "data" / "powiaty.geojson"
GMINY = BASE / "data" / "gminy.geojson"
SEATY = BASE / "siedziby.geojson"
OUT = BASE / "data" / "powiat_siedziby.json"

EXCEPTIONS = {
    "1432": "Ożarów Mazowiecki",
    "1006": "Łódź",
    "0415": "Włocławek",
    "0464": "Włocławek",
}

HYPHEN_SEAT = {
    "ropczycko-sędziszowski": "Ropczyce",
    "strzelecko-drezdenecki": "Strzelce Krajeńskie",
    "czarnkowsko-trzcianecki": "Czarnków",
}


def norm(s):
    s = (s or "").strip().lower()
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def title_name(s):
    return re.sub(r"(^|[\s-])(\S)", lambda m: m.group(1) + m.group(2).upper(), (s or "").strip())


def powiat_stem(nazwa):
    n = norm(nazwa)
    for suf in ("dzki", "cki", "ski", "zki"):
        if n.endswith(suf) and len(n) > len(suf) + 2:
            return n[: -len(suf)]
    return n


def city_matches_powiat(pow_nazwa, city_nazwa):
    stem = powiat_stem(pow_nazwa)
    cn = norm(city_nazwa)
    if not stem or len(stem) < 4:
        return False
    if cn.startswith(stem) or stem in cn:
        return True
    if stem.endswith("ow") and cn.startswith(stem + "k"):
        return True
    return False


def pick_city_gmina(pow_nazwa, gminy_in_pow):
    cities = [g for g in gminy_in_pow if g["properties"]["kod"].endswith("1")]
    if len(cities) == 1:
        return cities[0]["properties"]["nazwa"], cities[0]["properties"]["kod"]
    if len(cities) > 1:
        matched = [g for g in cities if city_matches_powiat(pow_nazwa, g["properties"]["nazwa"])]
        if len(matched) == 1:
            g = matched[0]
            return g["properties"]["nazwa"], g["properties"]["kod"]
        if matched:
            g = max(matched, key=lambda x: len(x["properties"]["nazwa"]))
            return g["properties"]["nazwa"], g["properties"]["kod"]
    return None, None


def prefer_miejska_gmina(gminy):
    for g in gminy:
        if g["properties"]["kod"].endswith("1"):
            return g
    return gminy[0] if gminy else None


def pick_from_seats(seat_name, seats_in_pow, gminy_in_pow):
    sn = norm(seat_name)
    exact = [g for g in gminy_in_pow if norm(g["properties"]["nazwa"]) == sn]
    if exact:
        g = prefer_miejska_gmina(exact)
        return g["properties"]["kod"], g["properties"]["nazwa"]
    for s in seats_in_pow:
        p = s["properties"]
        names = [p.get("name"), p.get("gmina_nazwa"), p.get("city_nazwa")]
        if any(norm(x) == sn for x in names if x):
            kod = p.get("gmina_kod")
            if kod and not kod.endswith("1"):
                miejska = next(
                    (g for g in gminy_in_pow if g["properties"]["kod"].endswith("1")
                     and norm(g["properties"]["nazwa"]) == sn),
                    None,
                )
                if miejska:
                    return miejska["properties"]["kod"], miejska["properties"]["nazwa"]
            return kod, seat_name
    partial = [g for g in gminy_in_pow
               if sn in norm(g["properties"]["nazwa"]) or norm(g["properties"]["nazwa"]) in sn]
    if partial:
        g = prefer_miejska_gmina(partial)
        return g["properties"]["kod"], g["properties"]["nazwa"]
    return None, seat_name


def pick_largest_town(seats_in_pow):
    best = None
    best_pop = -1
    for s in seats_in_pow:
        p = s["properties"]
        pop = int(p.get("seat_population") or p.get("gmina_population") or p.get("population") or 0)
        place = p.get("place", "")
        if pop > best_pop and place in ("city", "town", ""):
            best = p
            best_pop = pop
    if best:
        name = best.get("city_nazwa") or best.get("name") or best.get("gmina_nazwa")
        return name, best.get("gmina_kod")
    return None, None


def guess_seat_name(nazwa, teryt, gminy_in_pow, seats_in_pow):
    if teryt in EXCEPTIONS:
        return EXCEPTIONS[teryt]

    n = norm(nazwa)
    if n in HYPHEN_SEAT:
        return HYPHEN_SEAT[n]
    if " " in n:
        return title_name(nazwa)
    if "-" in n:
        return title_name(nazwa.split("-")[0])

    name, _ = pick_city_gmina(nazwa, gminy_in_pow)
    if name:
        return name

    name, _ = pick_largest_town(seats_in_pow)
    if name:
        return name

    stem = powiat_stem(nazwa)
    for g in gminy_in_pow:
        if city_matches_powiat(nazwa, g["properties"]["nazwa"]):
            return g["properties"]["nazwa"]

    return title_name(stem) if stem else title_name(nazwa)


def main():
    powiaty = json.loads(POWIATY.read_text(encoding="utf-8"))["features"]
    gminy = json.loads(GMINY.read_text(encoding="utf-8"))["features"]
    seats = json.loads(SEATY.read_text(encoding="utf-8"))["features"]

    gminy_by_pow = {}
    for g in gminy:
        gminy_by_pow.setdefault(g["properties"]["kod"][:4], []).append(g)

    entries = []
    for pf in powiaty:
        teryt = pf["properties"]["teryt"]
        nazwa = pf["properties"]["nazwa"]
        poly = shape(pf["geometry"])
        seats_in = [s for s in seats if poly.contains(Point(*s["geometry"]["coordinates"]))]
        gminy_in = gminy_by_pow.get(teryt, [])

        seat_name = guess_seat_name(nazwa, teryt, gminy_in, seats_in)
        kod, resolved = pick_from_seats(seat_name, seats_in, gminy_in)
        if not kod:
            _, kod = pick_city_gmina(nazwa, gminy_in)
            if kod:
                resolved = seat_name

        entries.append({
            "powiat_teryt": teryt,
            "powiat_nazwa": nazwa,
            "siedziba": seat_name,
            "siedziba_rozwiązana": resolved,
            "gmina_kod": kod,
        })

    OUT.write_text(json.dumps({
        "zrodlo": "gmina miejska w powiecie + dopasowanie nazwy + wyjątki",
        "pozycje": sorted(entries, key=lambda x: x["powiat_nazwa"]),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    haj = next(e for e in entries if e["powiat_teryt"] == "2005")
    print(f"OK: {len(entries)}")
    print("hajnowski:", haj)


if __name__ == "__main__":
    main()
