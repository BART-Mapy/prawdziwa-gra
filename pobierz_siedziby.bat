@echo off
cd /d "%~dp0"
echo Pobieranie siedzib z OSM (Overpass)...
echo To moze potrwac 1-3 minuty przy pierwszym uruchomieniu.
py fetch_siedziby.py
pause
