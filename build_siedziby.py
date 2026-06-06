"""Uzupełnia siedziby.geojson o brakujące siedziby gmin z export.geojson."""
import json
import re
from pathlib import Path

from shapely.geometry import Point, shape

BASE = Path(__file__).parent


def norm(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"^gmina\s+", "", s)
    s = re.sub(r"^m\.\s+", "", s)
    return s


def parse_pop(value) -> int:
    if value is None:
        return 0
    return int(str(value).replace(" ", "").replace("\u00a0", "") or 0)


def has_seat(gmin_feat, seats) -> bool:
    kod = gmin_feat["properties"]["kod"]
    pref = kod[:6]
    gn = norm(gmin_feat["properties"]["nazwa"])
    gpoly = shape(gmin_feat["geometry"])

    for sf in seats:
        props = sf["properties"]
        lon, lat = sf["geometry"]["coordinates"]
        terc = (props.get("teryt:terc") or props.get("kod") or "")[:6]
        if terc and terc == pref:
            return True
        sn = norm(props.get("name:pl") or props.get("name") or props.get("nazwa"))
        if sn == gn and gpoly.contains(Point(lon, lat)):
            return True
    return False


def pick_export_seat(gmin_feat, exp_points):
    gpoly = shape(gmin_feat["geometry"])
    kod = gmin_feat["properties"]["kod"]
    gn = norm(gmin_feat["properties"]["nazwa"])

    inside = []
    for feat in exp_points:
        lon, lat = feat["geometry"]["coordinates"]
        if not gpoly.contains(Point(lon, lat)):
            continue
        inside.append(feat)

    if not inside:
        return None

    def props(f):
        return f["properties"]

    for feat in inside:
        p = props(feat)
        if p.get("teryt:terc") == kod and p.get("place") in ("town", "village", "city"):
            return feat

    for feat in inside:
        p = props(feat)
        name = norm(p.get("name:pl") or p.get("name"))
        if name == gn and p.get("place") in ("town", "village", "city"):
            return feat

    places = [
        f for f in inside
        if props(f).get("place") in ("town", "village", "city")
        and parse_pop(props(f).get("population"))
    ]
    if places:
        return max(places, key=lambda f: parse_pop(props(f).get("population")))

    for feat in inside:
        p = props(feat)
        if p.get("teryt:terc") == kod and p.get("boundary") == "administrative":
            return feat

    for feat in inside:
        p = props(feat)
        name = norm(p.get("name:pl") or p.get("name"))
        if name == gn:
            return feat

    return None


def export_to_siedziba(feat, gmin_feat):
    p = feat["properties"]
    gmin_name = gmin_feat["properties"]["nazwa"]
    raw_name = p.get("name:pl") or p.get("name") or gmin_name
    name = norm(raw_name)
    if not name:
        name = norm(gmin_name)
    display = raw_name
    if display.lower().startswith("gmina "):
        display = gmin_name

    pop = parse_pop(p.get("population"))
    kod = p.get("teryt:terc") or gmin_feat["properties"]["kod"]
    lon, lat = feat["geometry"]["coordinates"]

    return {
        "type": "Feature",
        "properties": {
            "name": display,
            "name:pl": display,
            "population": str(pop) if pop else "",
            "teryt:terc": kod,
            "source": "export.geojson",
            "gmina_kod": gmin_feat["properties"]["kod"],
        },
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def main():
    siedziby_path = BASE / "siedziby.geojson"
    with siedziby_path.open(encoding="utf-8") as f:
        siedziby = json.load(f)

    with (BASE / "data" / "gminy.geojson").open(encoding="utf-8") as f:
        gminy = json.load(f)

    with (BASE / "export.geojson").open(encoding="utf-8") as f:
        export = json.load(f)

    exp_points = [f for f in export["features"] if f["geometry"]["type"] == "Point"]
    seats = list(siedziby["features"])
    added = 0

    exp_by_terc = {
        f["properties"]["teryt:terc"]: f
        for f in exp_points
        if f["properties"].get("teryt:terc")
    }

    for gmin_feat in gminy["features"]:
        if has_seat(gmin_feat, seats):
            continue
        pick = pick_export_seat(gmin_feat, exp_points)
        if not pick:
            kod = gmin_feat["properties"]["kod"]
            pick = exp_by_terc.get(kod)
        if not pick:
            gpoly = shape(gmin_feat["geometry"])
            c = gpoly.centroid
            seats.append({
                "type": "Feature",
                "properties": {
                    "name": gmin_feat["properties"]["nazwa"],
                    "name:pl": gmin_feat["properties"]["nazwa"],
                    "population": "",
                    "teryt:terc": kod,
                    "source": "gminy.geojson-centroid",
                    "gmina_kod": kod,
                },
                "geometry": {"type": "Point", "coordinates": [c.x, c.y]},
            })
            added += 1
            continue
        new_feat = export_to_siedziba(pick, gmin_feat)
        seats.append(new_feat)
        added += 1

    out = {
        "type": "FeatureCollection",
        "generator": "build_siedziby.py",
        "features": seats,
    }
    with siedziby_path.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Było: {len(siedziby['features'])}, dodano: {added}, razem: {len(seats)}")


if __name__ == "__main__":
    main()
