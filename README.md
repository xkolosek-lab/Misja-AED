# Namiar na puls – wspólny zbiór danych o defibrylatorach AED (prototyp)

Prototyp na HackNation 2026 (zadanie „Misja AED – Dane na ratunek”). Łączy dane o defibrylatorach AED
z wielu źródeł (pliki dysponentów, zbiory z dane.gov.pl, formularz dysponenta) w jeden zbiór zgodny z wzorcowym
zakresem danych dla portalu dane.gov.pl. Scalanie działa w całości w przeglądarce, bez kluczy API. Na końcu kroku 4
można **zasymulować** zatwierdzenie zbioru „do bazy gov.pl” – zgłoszenie trafia do lokalnej bazy SQLite `wyniki.gov`.

**To nie jest serwis administracji publicznej.** Wygląd (kolory, przyciski, fokus, krój Open Sans) jest wzorowany
na www.gov.pl, ale strona nie używa godła ani logotypu gov.pl, ma własny znak i nazwę „Namiar na puls” oraz widoczne
oznaczenie „Prototyp”. Żadne dane nie trafiają do prawdziwych systemów gov.pl.

Usługi zewnętrzne (publiczne, bez kluczy):
- **API dane.gov.pl** – wyszukiwanie i pobieranie opublikowanych zbiorów o AED (krok 1),
- **GUGiK / Geoportal.gov.pl** – podkłady mapy w EPSG:3857: mapa topograficzna (WMS `img/guest/TOPO`),
  ortofotomapa (WMTS `PZGIK/ORTO/WMTS/StandardResolution`, macierz `EPSG:3857`) i nakładka punktów adresowych
  i ulic (WMS Krajowej Integracji Numeracji Adresowej); atrybucja „© Główny Urząd Geodezji i Kartografii”,
- **GUGiK UUG** (Usługa Geokodowania, `services.gugik.gov.pl/uug`) – wyszukiwanie adresu i adres najbliższy punktowi
  w formularzu dysponenta, **GUGiK ULDK** (`uldk.gugik.gov.pl`) – gmina i kod TERC dla punktu.

Mapa nigdy nie jest jedynym sposobem: wszystko, co pokazuje, jest też dostępne jako tekst (listy, legenda z liczbami,
pola współrzędnych, wyszukiwanie adresu).

## Uruchomienie

- **Zalecane – lokalny serwer z bazą `wyniki.gov`:**

  ```
  python serwer.py
  ```
  i wejdź na http://127.0.0.1:8000 (opcje: `--port N`, `--host`, `--baza ścieżka`). Zgłoszenia z kroku 4 zapisują się
  w pliku `wyniki.gov` w katalogu projektu.
- **Serwer statyczny / GitHub Pages:** np. `python -m http.server 8765` – wszystko działa, a baza `wyniki.gov` powstaje
  w przeglądarce (sql.js, zapis w IndexedDB); plik pobierzesz przyciskiem „Pobierz plik wyniki.gov”.
- **Plik z dysku (dwuklik `index.html`):** scalanie działa, ale wysyłka do bazy wymaga serwera (`python serwer.py`).
- **GitHub Pages:** patrz sekcja [Wdrożenie](#wdrożenie).

## Struktura

```
index.html            ekrany aplikacji (sekcje przełączane #hashem)
css/style.css         style (tokeny kolorów w :root, WCAG 2.2 AA)
js/core/              przestrzeń nazw, stan (źródła, rekordy, duplikaty, wynik), router,
                      normalizacja, mapowanie, walidacja, duplikaty.js (wykrywanie i scalanie),
                      eksport.js (CSV, XLSX, JSON, GeoJSON, rejestr źródeł, datapackage, metadane XML)
js/schema/schema.js   schemat wzorca – GENEROWANY przez wzorzec/generuj_wzorzec.py
js/core/formularz.js  logika formularza dysponenta (pola, normalizacja, walidacja, CSV, szkic)
js/sources/file.js    wczytywanie CSV/XLSX/XLS/ODS/JSON/GeoJSON
js/sources/dgp.js     API dane.gov.pl
js/sources/geokoder.js  geokodowanie GUGiK (UUG, ULDK)
js/core/gov.js        symulowana wysyłka „do bazy gov.pl”: gotowość 4 kroków, zgłoszenie, zapis w wyniki.gov (API serwera
                      albo sql.js w przeglądarce); schemat bazy: js/core/gov_schemat.sql (wspólny z serwer.py)
js/ui/                ekrany i pomocnicze funkcje DOM: zdalne.js (dane.gov.pl, krok 1), duplikaty.js (krok 3),
                      wynik.js (krok 4), gov.js (przycisk „Wyślij do zatwierdzenia przez bazę gov.pl”),
                      mapa.js (Leaflet + podkłady GUGiK), formularz.js (formularz dysponenta)
serwer.py             lokalny serwer: aplikacja + /api/* bazy wyniki.gov (Python 3, bez zależności)
vendor/sqljs/         sql.js (SQLite w WebAssembly) – ładowany leniwie tylko w trybie przeglądarkowym
vendor/open-sans/     krój Open Sans (SIL OFL 1.1), ten sam co na gov.pl
wzorzec/              prosty formularz dla dysponentów (formularz_dysponenta_AED.xlsx / .csv – jeden wiersz = jedno
                      urządzenie), pełny wzorcowy zakres danych (xlsx, csv, schema.json) + generator
tests/*.test.js       testy logiki w Node (bez przeglądarki), uruchamiane przez tests/uruchom.js
tests/e2e/            testy end-to-end w headless Edge/Chrome (CDP, bez zależności npm)
tests/fixtures/       pliki testowe (prawdziwe zbiory z dane.gov.pl, odpowiedzi API GUGiK + dane fikcyjne)
tests/mock-*.js       atrapy modułów do testów interfejsu (nie dołączać do index.html)
tests/waliduj_xml.py  sprawdzenie pliku metadanych XML ze schematem harvestera (wymaga lxml)
otwarte_dane_latest.xsd  schemat XML harvestera dane.gov.pl
vendor/               biblioteki (kopie lokalne z licencjami) – patrz LICENSES.md
```

## Formularz dysponenta

- **Na stronie** (`#formularz`): trzy kroki z widocznym postępem – instytucja, urządzenia, przekazanie (plik CSV
  albo „Dodaj do scalania”). Na start widać tylko pola obowiązkowe, warunkowe i adres; pozostałe są w „Więcej (opcjonalnie)”.
- **Arkusz do pobrania:** „Pobierz prosty formularz (Excel)” (`wzorzec/formularz_dysponenta_AED.xlsx`), wersja CSV
  (UTF-8 z BOM). Pełny wzorcowy zakres danych zostaje jako materiał dla koordynatorów i zaawansowanych.

## Baza wyniki.gov (symulacja gov.pl)

Przycisk „Wyślij do zatwierdzenia przez bazę gov.pl” w kroku 4, pod metadanymi jest aktywny, gdy gotowe są wszystkie
4 kroki (źródła, mapowanie współrzędnych, walidacja i wyszukanie duplikatów, poprawne metadane); w przeciwnym razie
pokazuje listę braków z linkami. Każde kliknięcie zapisuje **nowe** zgłoszenie (numer, data, status `zatwierdzono_gov`,
dane 4 kroków, suma kontrolna) i pokazuje tylko komunikat „Dane zostały wysłane do bazy dane.gov.pl”.

- **Tryb serwera** (`python serwer.py`): `GET /api/status`, `POST /api/zgloszenia`, `GET /api/statystyki`,
  `GET /api/baza` (spójna kopia pliku). Plik `baza/wyniki.gov` (opis: `baza/README.md`) leży w katalogu projektu i nie jest serwowany bezpośrednio.
- **Tryb przeglądarki** (serwer statyczny, GitHub Pages): ta sama baza w sql.js, zapis w IndexedDB tej przeglądarki –
  znika po wyczyszczeniu danych witryny lub w trybie prywatnym, nie jest wspólna dla innych przeglądarek. Pod `file://`
  nie działa (komunikat z poleceniem `python serwer.py`).
- Tabele `zgloszenia` i `rekordy_aed`, widoki `podsumowanie`, `zgloszenia_wg_statusu`, `statystyki_dzienne`.
  Liczba zgłoszeń: `sqlite3 wyniki.gov "SELECT COUNT(*) FROM zgloszenia"` albo bez sqlite3:
  `python -c "import sqlite3; print(sqlite3.connect('wyniki.gov').execute('SELECT COUNT(*) FROM zgloszenia').fetchone()[0])"`.
- Tryb wykrywany jest bez błędów 404: aplikacja robi HEAD na bieżącą stronę i sprawdza nagłówek `X-Namiar-Serwer`,
  który dodaje serwer.py (`GET /api/status` zostaje do diagnostyki).

## Wygląd i dostępność

Tokeny w `:root` (`css/style.css`) mają wartości odczytane z arkuszy www.gov.pl: tekst `#1b1b1b`, kolor podstawowy
`#0052a5` (hover `#006cd7`), fokus – podwójny pierścień `#0452a8`/biały/`#0452a8`, tła `#f1f1f1`, pola z ramką
`#808893`, stan nieaktywny `#656565`, czerwień `#d5233f` (linia stopki). Kontrast tekstu ≥ 4,5:1, elementów UI ≥ 3:1
(liczby przy tokenach). Przyciski zablokowane używają `aria-disabled` (zostają w kolejności Tab i mają opis przyczyny).

Zgodność z WCAG 2.2 AA sprawdza test e2e `dostepnosc` (`node tests/e2e/uruchom.js dostepnosc`): audyt axe-core
(reguły WCAG 2.0/2.1/2.2, poziomy A i AA) na wszystkich ekranach – bez danych i z danymi w krokach 1–4 – przy 1280 px
i 360 px, tytuł strony opisujący bieżący ekran (2.4.2) oraz to, że przypięty pasek „Wstecz / Następny krok” na telefonie
nie zasłania elementu z fokusem (2.4.11). Audyt automatyczny nie zastępuje testu z czytnikiem ekranu (NVDA, VoiceOver).

## Zgodność z zasadami dane.gov.pl

Podstawa: ustawa z 11 sierpnia 2021 r. o otwartych danych i ponownym wykorzystywaniu informacji sektora publicznego,
regulamin portalu oraz Standardy otwartości danych (techniczny, prawny, API) – https://dane.gov.pl/pl/knowledgebase.
Reguły importu sprawdziliśmy też w kodzie źródłowym portalu (backend „mcod”: harvester XML, lista obsługiwanych formatów).

| Zasada portalu | Jak spełnia ją aplikacja | Jak sprawdzone |
|---|---|---|
| Format odczytywalny maszynowo, otwarty | Eksport CSV (zalecany, UTF-8), JSON, GeoJSON, XLSX, metadane XML, `datapackage.json`; brak PDF/DOC | portal ocenia CSV/JSON/GeoJSON na 3★, XLSX na 2★ (ustawienia backendu) |
| Standard techniczny | UTF-8, wiersz nagłówka, kropka dziesiętna, daty ISO 8601, współrzędne WGS84 | wzorzec `wzorzec/schema.json`, testy `tests/czesc4.test.js` |
| Harvester XML | Plik metadanych zgodny ze schematem `xml_import_otwarte_dane_1_13.xsd` (kopia: `otwarte_dane_latest.xsd`, identyczna z najnowszą wersją w kodzie portalu) | walidacja lxml w `tests/czesc4.test.js` |
| Słowniki portalu | Kategorie (13), częstotliwość aktualizacji (8), licencje (7), status, dostępność zasobu, języki – zgodne w 100% ze schematem; kategoria zbioru AED: Zdrowie (HEAL) | porównanie z wyliczeniami w XSD |
| Reguły harvestera spoza XSD | `extIdent` maks. 36 znaków; adresy zasobów tylko `https://`; warunek dla bazy danych (`dbOrCopyrighted`) zawsze razem z wybraną licencją (`dbOrCopyrightedLicenseChosen`) | `AED.eksport.walidujMetadane`, testy w `tests/czesc4.test.js` |
| Swobodne ponowne wykorzystanie | Licencje CC0 1.0 (zalecana) i CC BY 4.0; licencja zbioru wyliczana z licencji rekordów, atrybucje dla CC BY | testy scalania i licencji |
| Aktualność i ciągłość | Stały identyfikator urządzenia `id_aed` (UUID) i stały `extIdent` zbioru; aktualizacja istniejącego zbioru zamiast nowego; urządzeń wycofanych nie usuwamy (status „wycofany”) | testy mapowania i scalania |
| Ochrona danych | Zbiór opisuje urządzenia i instytucje. Telefon i e-mail mają być służbowe – formularz o tym informuje i ostrzega, gdy e-mail wygląda na prywatny (np. gmail.com) lub imienny (imię.nazwisko) | test e2e `formularz` |

Ograniczenia:

- Przycisk „Wyślij do zatwierdzenia przez bazę gov.pl” to **symulacja** (zapis w lokalnej bazie i plik `wyniki_gov.txt`).
  Do prawdziwego portalu dane trafiają przez konto dostawcy danych (ręcznie) albo harvester pobierający plik XML spod
  adresu instytucji.
- Nie wykonaliśmy importu na produkcyjnym portalu (wymaga konta dostawcy). Harvester pobiera każdy zasób i sprawdza
  jego typ (`Content-Type`) – to zależy od serwera instytucji, która publikuje pliki. Kody TERYT regionów portal
  weryfikuje własną usługą; aplikacja sprawdza tylko ich format.

## Wzorzec danych – jedno źródło prawdy

```
pip install openpyxl
python wzorzec/generuj_wzorzec.py
```
Generuje: `wzorzec/wzorcowy_zakres_danych_AED.xlsx`, `szablon_aed.csv`, `przyklad_aed.csv`,
`schema.json` (Frictionless Table Schema) oraz `js/schema/schema.js` używany przez aplikację.

## Testy

- **Logika (Node 18+):** `node tests/uruchom.js` – wszystkie pliki `tests/*.test.js` (np. `node tests/uruchom.js czesc5`).
  `czesc6` uruchamia też `serwer.py`, więc wymaga **Pythona 3** w PATH.
- **End-to-end (przeglądarka, Node 22+ – potrzebny wbudowany `WebSocket` do sterowania przeglądarką):** `node tests/e2e/uruchom.js`
  - wymaga **Microsoft Edge albo Google Chrome / Chromium** (wykrywane automatycznie; inną ścieżkę wskaż zmienną
    `AED_PRZEGLADARKA`) oraz **Pythona 3** w PATH – skrypt sam uruchamia `python serwer.py` na wolnym porcie
    z bazą w pliku tymczasowym (bez serwer.py – `python -m http.server`) i zamyka go na końcu; bez zależności npm,
  - domyślnie **bez internetu**: kafle mapy GUGiK zastępuje lokalny obrazek, geokoder – atrapa (`tests/mock-czesc5.js`);
    `--siec` wyłącza blokadę, `--zrzuty` zapisuje zrzuty ekranu, nazwa testu uruchamia tylko jego
    (np. `node tests/e2e/uruchom.js formularz`),
  - sprawdza: przepływ kroków 1→4 na plikach z `tests/fixtures`, formularz dysponenta (wyszukanie adresu, mapa,
    walidacja, szkic, CSV, „Dodaj do scalania”), inicjalizację map, szerokość 320 px bez poziomego przewijania,
    brak błędów w konsoli i podstawową obsługę klawiaturą; test `gov` – wysyłkę do bazy wyniki.gov (przycisk
    zablokowany przed ukończeniem kroków, 2 zgłoszenia, liczba 1 → 2, pobrany plik SQLite) w trybie serwera
    i przeglądarki.

## Wdrożenie

`.github/workflows/testy.yml` uruchamia testy przy każdym pushu i pull requeście, a `.github/workflows/pages.yml`
publikuje stronę na GitHub Pages (po zaliczonych testach). Jednorazowo w repozytorium:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Stan prac

- [x] Część 1: szkielet, router, źródło „Plik”, rejestr źródeł
- [x] Część 2: zbiory z dane.gov.pl (API)
- [x] Część 3: mapowanie kolumn, normalizacja, walidacja
- [x] Część 4: duplikaty i punkty odstające, wynik, eksport (CSV, XLSX, JSON, GeoJSON, rejestr źródeł,
  datapackage.json, metadane XML), instrukcja publikacji w dane.gov.pl
- [x] Część 5: formularz dysponenta (z wyszukiwaniem adresu GUGiK i szkicem w przeglądarce), mapa (Leaflet,
  podkłady GUGiK) w krokach 3 i 4 oraz w formularzu, testy e2e, wdrożenie na GitHub Pages
- [x] Część 6: nazwa „Namiar na puls”, stylistyka wzorowana na gov.pl, symulowana wysyłka do bazy `wyniki.gov`
  (serwer.py + sql.js), prosty formularz dla dysponentów (XLSX/CSV), uproszczony formularz na stronie
