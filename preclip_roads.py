"""Wcześniej przycina drogi do powiatów i gmin — uruchom raz: py preclip_roads.py"""
import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.prepared import prep
from shapely.strtree import STRtree

BASE = Path(__file__).parent
DATA = BASE / "data"
OUT_POW = DATA / "drogi_powiat"
OUT_GMIN = DATA / "drogi_gmina"

ROAD_FILES = {
    "kraj": "drogi_krajowa.geojson",
    "woj": "drogi_wojewodzka.geojson",
    "pow": "drogi_powiatowa.geojson",
    "gmin": "drogi_gminna.geojson",
}


def load_geojson(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_geojson(path, features):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False, separators=(",", ":"))


def geom_to_line_features(geom, props):
    out = []
    if geom.is_empty:
        return out
    gtype = geom.geom_type
    if gtype == "LineString":
        out.append({"type": "Feature", "properties": props, "geometry": mapping(geom)})
    elif gtype == "MultiLineString":
        for part in geom.geoms:
            out.extend(geom_to_line_features(part, props))
    elif gtype == "GeometryCollection":
        for part in geom.geoms:
            out.extend(geom_to_line_features(part, props))
    return out


def clip_roads_to_area(road_index, area_geom):
    prepared = prep(area_geom)
    clipped = []
    for road_feat, road_geom in road_index:
        if not prepared.intersects(road_geom):
            continue
        inter = road_geom.intersection(area_geom)
        props = dict(road_feat["properties"])
        clipped.extend(geom_to_line_features(inter, props))
    return clipped


def build_road_index():
    entries = []
    geoms = []
    kats = []
    for kat, filename in ROAD_FILES.items():
        path = DATA / filename
        if not path.exists():
            print(f"  pominięto (brak pliku): {filename}")
            continue
        geojson = load_geojson(path)
        for feat in geojson["features"]:
            geom = shape(feat["geometry"])
            if geom.is_empty:
                continue
            entries.append(feat)
            geoms.append(geom)
            kats.append(kat)
        print(f"  {filename}: {len(geojson['features'])} obiektów")
    tree = STRtree(geoms) if geoms else None
    return entries, geoms, kats, tree


def clip_roads_to_area_fast(entries, geoms, kats, tree, area_geom):
    if tree is None:
        return []
    prepared = prep(area_geom)
    clipped = []
    for idx in tree.query(area_geom):
        road_feat = entries[idx]
        road_geom = geoms[idx]
        if not prepared.intersects(road_geom):
            continue
        inter = road_geom.intersection(area_geom)
        props = dict(road_feat.get("properties") or {})
        props["kat"] = kats[idx]
        clipped.extend(geom_to_line_features(inter, props))
    return clipped


def generate_for_units(units_geojson, out_dir, id_key, entries, geoms, kats, tree):
    out_dir.mkdir(parents=True, exist_ok=True)
    total = len(units_geojson["features"])
    for i, feat in enumerate(units_geojson["features"], 1):
        unit_id = feat["properties"][id_key]
        area = shape(feat["geometry"])
        roads = clip_roads_to_area_fast(entries, geoms, kats, tree, area)
        save_geojson(out_dir / f"{unit_id}.geojson", roads)
        if i % 50 == 0 or i == total:
            print(f"    {i}/{total}")
    return total


def main():
    print("Indeksowanie dróg...")
    entries, geoms, kats, tree = build_road_index()
    if not entries:
        print("Brak dróg do przetworzenia.")
        return

    print("Przycinanie do powiatów...")
    powiaty = load_geojson(DATA / "powiaty.geojson")
    n_pow = generate_for_units(powiaty, OUT_POW, "teryt", entries, geoms, kats, tree)
    print(f"  zapisano {n_pow} plików w {OUT_POW}")

    print("Przycinanie do gmin...")
    gminy = load_geojson(DATA / "gminy.geojson")
    n_gmin = generate_for_units(gminy, OUT_GMIN, "kod", entries, geoms, kats, tree)
    print(f"  zapisano {n_gmin} plików w {OUT_GMIN}")

    print("Gotowe!")


if __name__ == "__main__":
    main()
