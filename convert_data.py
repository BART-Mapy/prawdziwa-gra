"""Konwertuje pliki SHP do GeoJSON (WGS84) dla mapy HTML."""
import json
import re
import os
from pathlib import Path

import shapefile
from pyproj import Transformer
from shapely.geometry import shape, mapping, LineString, MultiLineString

BASE = Path(__file__).parent
DATA = BASE / "data"
DATA.mkdir(exist_ok=True)

TO_WGS84 = Transformer.from_crs("EPSG:2180", "EPSG:4326", always_xy=True)


def round_coords(coords, precision=5):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], precision), round(coords[1], precision)]
    return [round_coords(c, precision) for c in coords]


def reproject_geom(geom_dict, needs_reproject=True):
    if not needs_reproject:
        return round_coords(geom_dict["coordinates"])
    gtype = geom_dict["type"]
    coords = geom_dict["coordinates"]
    if gtype == "Point":
        x, y = coords
        lon, lat = TO_WGS84.transform(x, y)
        return [round(lon, 5), round(lat, 5)]
    if gtype in ("LineString", "MultiPoint"):
        return [list(TO_WGS84.transform(x, y)) for x, y in coords]
    if gtype in ("Polygon", "MultiLineString"):
        return [[list(TO_WGS84.transform(x, y)) for x, y in ring] for ring in coords]
    if gtype == "MultiPolygon":
        return [
            [[list(TO_WGS84.transform(x, y)) for x, y in ring] for ring in poly]
            for poly in coords
        ]
    return coords


def shp_to_geojson(shp_name, out_name, properties_fn, needs_reproject=True, simplify=0.0, encoding="utf-8"):
    path = BASE / shp_name
    sf = shapefile.Reader(str(path), encoding=encoding)
    fields = [f[0] for f in sf.fields[1:]]
    features = []

    for shp_rec, attr_rec in zip(sf.iterShapes(), sf.iterRecords()):
        if shp_rec.shapeType == shapefile.NULL:
            continue
        geom = shp_rec.__geo_interface__
        coords = reproject_geom(geom, needs_reproject)
        feature_geom = {"type": geom["type"], "coordinates": round_coords(coords)}

        if simplify > 0:
            try:
                g = shape(feature_geom)
                g = g.simplify(simplify, preserve_topology=True)
                feature_geom = mapping(g)
                feature_geom["coordinates"] = round_coords(feature_geom["coordinates"])
            except Exception:
                pass

        props = properties_fn(dict(zip(fields, attr_rec)))
        if props is None:
            continue
        features.append({"type": "Feature", "properties": props, "geometry": feature_geom})

    out = {"type": "FeatureCollection", "features": features}
    out_path = DATA / out_name
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  {out_name}: {len(features)} obiektów")
    return len(features)


def road_category(num, klasa):
    num = str(num or "").strip()
    klasa = str(klasa or "").strip().lower()

    if klasa == "autostrada" or num.upper().startswith("A"):
        return "krajowa"
    if klasa in ("droga ekspresowa", "droga główna ruchu przyśpieszonego") or num.upper().startswith("S"):
        return "krajowa"
    if re.match(r"^\d{1,2}$", num) or klasa == "droga główna":
        return "krajowa"
    if re.match(r"^\d{3}$", num):
        return "wojewodzka"
    if re.match(r"^\d{4}", num) or klasa == "droga zbiorcza":
        return "powiatowa"
    return "gminna"


def convert_roads():
    sf = shapefile.Reader(str(BASE / "drogi.shp"), encoding="cp1250")
    fields = [f[0] for f in sf.fields[1:]]
    categories = {"krajowa": [], "wojewodzka": [], "powiatowa": [], "gminna": []}

    for shp_rec, attr_rec in zip(sf.iterShapes(), sf.iterRecords()):
        if shp_rec.shapeType == shapefile.NULL:
            continue
        d = dict(zip(fields, attr_rec))
        kat = road_category(d.get("numerDrogi"), d.get("klasaDrogi"))
        geom = shp_rec.__geo_interface__
        coords = reproject_geom(geom, True)
        props = {
            "numer": str(d.get("numerDrogi", "")).strip(),
            "klasa": str(d.get("klasaDrogi", "")).strip(),
            "kat": kat,
        }
        feature = {
            "type": "Feature",
            "properties": props,
            "geometry": {"type": geom["type"], "coordinates": round_coords(coords, 5)},
        }
        categories[kat].append(feature)

    for kat, feats in categories.items():
        out_path = DATA / f"drogi_{kat}.geojson"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  drogi_{kat}.geojson: {len(feats)} obiektów")


def main():
    print("Konwersja danych...")

    shp_to_geojson(
        "wojewodztwa.shp",
        "wojewodztwa.geojson",
        lambda d: {"nazwa": d["Nazwa"], "teryt": d["TERYT"]},
        needs_reproject=True,
        simplify=0.001,
    )

    shp_to_geojson(
        "powiat.shp",
        "powiaty.geojson",
        lambda d: {"nazwa": d["Nazwa"].replace("powiat ", ""), "teryt": d["TERYT"]},
        needs_reproject=True,
        simplify=0.0005,
    )

    shp_to_geojson(
        "gminy.shp",
        "gminy.geojson",
        lambda d: {"nazwa": d["JPT_NAZWA_"], "kod": d["JPT_KOD_JE"]},
        needs_reproject=False,
        simplify=0.0003,
        encoding="utf-8",
    )

    convert_roads()
    print("Aby przyciąć drogi do powiatów/gmin (raz): py preclip_roads.py")
    print("Gotowe!")


if __name__ == "__main__":
    main()
