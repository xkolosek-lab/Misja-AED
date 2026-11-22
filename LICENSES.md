# Licencje elementów zewnętrznych

Kod aplikacji, grafiki i wzorzec danych są autorską pracą zespołu. Poniższe elementy zewnętrzne
pozostają na swoich licencjach (nie podlegają przeniesieniu praw na Ministra Cyfryzacji – można je
dalej swobodnie używać na warunkach tych licencji).

| Element | Wersja | Licencja | Plik licencji | Źródło |
|---|---|---|---|---|
| PapaParse | 5.4.1 | MIT | `vendor/papaparse/LICENSE` | https://www.papaparse.com |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | `vendor/sheetjs/LICENSE` | https://cdn.sheetjs.com (nie używamy wersji z npm 0.18.5 – znane podatności) |
| Leaflet (js, css, ikony, mapa źródeł) | 1.9.4 | BSD-2-Clause | `vendor/leaflet/LICENSE` | https://leafletjs.com (kopia z cdnjs, suma SHA-256 leaflet.js zgodna z unpkg) |
| sql.js (SQLite w WebAssembly; zawiera SQLite – domena publiczna) | 1.13.0 | MIT, © 2017 sql.js authors | `vendor/sqljs/LICENSE` | https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/ (ładowany leniwie w trybie przeglądarkowym) |
| Open Sans (krój pisma, woff2 latin + latin-ext, 400/600/700) | @fontsource/open-sans 5.2.7 | SIL Open Font License 1.1 | `vendor/open-sans/LICENSE` | https://github.com/googlefonts/opensans (pliki z https://cdn.jsdelivr.net/npm/@fontsource/open-sans@5.2.7) |
| openpyxl (tylko generator wzorca, Python) | 3.1.x | MIT | — | https://openpyxl.readthedocs.io |
| lxml (tylko test `tests/waliduj_xml.py`, Python; nie jest częścią aplikacji) | 6.x | BSD-3-Clause | — | https://lxml.de |

## Dane

| Dane | Licencja | Wymóg |
|---|---|---|
| Zbiory z dane.gov.pl w `tests/fixtures` | CC0 1.0 / CC BY 4.0 | szczegóły w `tests/fixtures/README.md` |
| axe-core 4.14.1 w `tests/vendor/axe-core` (tylko testy dostępności, nie trafia na stronę) | MPL-2.0 | `tests/vendor/axe-core/LICENSE` |

## Usługi zewnętrzne (wywoływane z przeglądarki użytkownika, bez kluczy)

| Usługa | Do czego | Warunki |
|---|---|---|
| GUGiK – WMS mapy topograficznej, WMTS ortofotomapy, WMS KIN (punkty adresowe i ulice), mapy.geoportal.gov.pl | podkłady mapy | bez opłat; wykorzystanie bez ograniczeń z wyłączeniem automatycznego pobierania obrazów (harvesting); atrybucja na mapie: „© Główny Urząd Geodezji i Kartografii (Geoportal.gov.pl)”; regulamin Geoportalu |
| GUGiK – Usługa Geokodowania UUG (services.gugik.gov.pl/uug) i ULDK (uldk.gugik.gov.pl) | wyszukiwanie adresu, adres i gmina dla punktu (formularz dysponenta) | publiczne usługi GUGiK; zapytania tylko na żądanie użytkownika, z odstępem między zapytaniami |
| API dane.gov.pl | wyszukiwanie i pobieranie zbiorów (krok 1) | dane na licencjach zbiorów (CC0 1.0 / CC BY 4.0) |

## Fonty i ikony

Krój Open Sans (SIL OFL 1.1, kopia lokalna w `vendor/open-sans`) – ten sam, którego używa www.gov.pl; zapasowo fonty
systemowe. Ikony SVG i znak „Namiar na puls” narysowane przez zespół. Nie używamy godła RP, logotypu gov.pl ani ikon gov.pl.
