/* Formularz dysponenta: dane dysponenta, urządzenie z wyszukaniem adresu (atrapa geokodera – bez sieci), mapa
   z klawiatury, walidacja z podsumowaniem, duplikowanie, usuwanie z cofnięciem, szkic po odświeżeniu, CSV,
   „Dodaj do scalania”, 320 px. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const { b, adres, ok } = t;
  fs.rmSync(t.pobrane, { recursive: true, force: true });
  await b.pobierania(t.pobrane);

  /** Atrapa geokodera (zawsze) i modułu formularza (gdy brak prawdziwego) – przed pierwszym wejściem na #formularz. */
  async function wczytajAtrape() {
    await b.ocen("window.AED_MOCK_CZESC5 = 'geokoder'; window.MOCK_OPOZNIENIE = 100; new Promise(function (ok, nie) {" +
      "const s = document.createElement('script'); s.src = 'tests/mock-czesc5.js?v=' + Date.now(); s.onload = ok; s.onerror = nie; document.body.appendChild(s); })");
  }
  async function wpiszPole(id, tekst) {
    await b.ocen("(function(){ const el = document.getElementById('" + id + "'); el.focus(); el.select && el.select(); })()");
    await b.wpisz(tekst);
    await b.ocen("document.getElementById('" + id + "').blur(); true");
  }
  async function wybierz(id, wartosc) {
    await b.ocen("(function(){ const el = document.getElementById('" + id + "'); el.value = '" + wartosc + "'; el.dispatchEvent(new Event('change', { bubbles: true })); })()");
  }

  await b.idz(adres + 'index.html#start');
  await wczytajAtrape();
  ok(await b.ocen('!!(AED.formularz && AED.geokoder && AED.geokoder.atrapa)'), 'moduł formularza i atrapa geokodera dostępne',
    await b.ocen('({ formularz: !!AED.formularz, geokoder: !!AED.geokoder })'));
  await b.ocen("location.hash = '#formularz'; true");
  await b.czekaj("document.activeElement && document.activeElement.id === 'h-formularz' && !!document.getElementById('fd-dysp')");
  ok(await b.ocen("/tylko w tej przeglądarce/.test(document.getElementById('fd-tresc').textContent)"), 'informacja: dane zostają tylko w tej przeglądarce');

  // ---- dysponent: autocomplete, normalizacja i błąd przy wyjściu z pola
  ok(await b.ocen("document.getElementById('fd-d-dysponent_nazwa').autocomplete === 'organization' && document.getElementById('fd-d-telefon_kontaktowy').autocomplete === 'tel' && document.getElementById('fd-d-email_kontaktowy').autocomplete === 'email'"),
    'pola kontaktowe mają autocomplete (organization, tel, email)');
  await wpiszPole('fd-d-dysponent_nazwa', 'Szkoła Podstawowa nr 1 w Krośnie');
  await wybierz('fd-d-dysponent_typ', 'placowka_oswiatowa');
  await wpiszPole('fd-d-telefon_kontaktowy', '13 432 00 00');
  ok(await b.ocen("document.getElementById('fd-d-telefon_kontaktowy').value === '134320000'"), 'telefon znormalizowany po wyjściu z pola',
    await b.ocen("document.getElementById('fd-d-telefon_kontaktowy').value"));
  await wpiszPole('fd-d-email_kontaktowy', 'sekretariat');
  ok(await b.ocen("document.getElementById('fd-d-email_kontaktowy').getAttribute('aria-invalid') === 'true' && !document.getElementById('fd-d-email_kontaktowy-blad').hidden && document.getElementById('fd-d-email_kontaktowy').getAttribute('aria-describedby').indexOf('fd-d-email_kontaktowy-blad') >= 0"),
    'błędny e-mail: komunikat przy polu, aria-invalid i aria-describedby');
  // dane kontaktowe są publiczne – prywatny albo imienny e-mail daje ostrzeżenie (nie blokuje)
  await wpiszPole('fd-d-email_kontaktowy', 'jan.kowalski@gmail.com');
  ok(await b.ocen("(function(){ const b = document.getElementById('fd-d-email_kontaktowy-blad'); return !b.hidden && b.className === 'field-warn' && /prywatn/.test(b.textContent) && !document.getElementById('fd-d-email_kontaktowy').hasAttribute('aria-invalid'); })()"),
    'prywatny e-mail: ostrzeżenie (nie błąd), że dane są publiczne');
  await wpiszPole('fd-d-email_kontaktowy', 'jan.kowalski@sp1.krosno.example.pl');
  ok(await b.ocen("/imienny/.test(document.getElementById('fd-d-email_kontaktowy-blad').textContent)"), 'imienny e-mail (imię.nazwisko): ostrzeżenie');
  await wpiszPole('fd-d-email_kontaktowy', 'sekretariat@sp1.krosno.example.pl');
  ok(await b.ocen("!document.getElementById('fd-d-email_kontaktowy').hasAttribute('aria-invalid')"), 'po poprawie e-mail błąd znika');

  // ---- nowe urządzenie
  await b.ocen("document.getElementById('fd-dodaj').focus()");
  await b.klawisz('Enter');
  await b.czekaj("document.activeElement && document.activeElement.id === 'h-fd-edytor'");
  ok(true, '„Dodaj urządzenie” (Enter) otwiera formularz urządzenia z fokusem na nagłówku');
  ok(await b.ocen("document.querySelectorAll('#fd-edytor fieldset.fd-grupa > legend').length >= 3"), 'pola pogrupowane (fieldset + legend)');
  await b.czekaj("!!document.querySelector('#fd-edytor .leaflet-container')");
  ok(true, 'mapa w formularzu zainicjowana');

  // zapis bez danych → podsumowanie błędów z linkami
  await b.ocen("document.querySelector('#fd-edytor button[type=submit]').click()");
  await b.czekaj("document.activeElement && document.activeElement.id === 'fd-e-bledy'");
  const linki = await b.ocen("document.querySelectorAll('#fd-e-podsumowanie a').length");
  ok(linki >= 3, 'zapis pustego urządzenia: podsumowanie błędów z fokusem i linkami', linki);
  await b.ocen("document.querySelector('#fd-e-podsumowanie a[href=\"#fd-e-nazwa\"]').click()");
  ok(await b.ocen("document.activeElement.id === 'fd-e-nazwa' && location.hash === '#formularz'"), 'link w podsumowaniu przenosi fokus do pola (bez zmiany ekranu)');
  await b.wpisz('Sala gimnastyczna');
  await b.ocen("document.getElementById('fd-e-nazwa').blur(); true");

  // wyszukanie adresu z klawiatury
  await b.ocen("document.getElementById('fd-geo-adres').focus()");
  await b.wpisz('Krosno, Lwowska 28A');
  await b.klawisz('Enter');
  await b.czekaj("document.querySelectorAll('#fd-geo-wyniki button').length === 2 && document.activeElement === document.querySelector('#fd-geo-wyniki button')");
  ok(true, 'wyszukanie adresu (Enter): propozycje, fokus na pierwszej');
  await b.klawisz('Enter');
  await b.pauza(200);
  ok(await b.ocen("document.getElementById('fd-e-szerokosc_geograficzna').value === '49.688712' && document.getElementById('fd-e-miejscowosc').value === 'Krosno' && AED.ui.formularz.stan.edycja.rekord.zrodlo_wspolrzednych === 'geokodowanie_adresu'"),
    'wybór adresu: współrzędne, miejscowość i źródło „geokodowanie_adresu”',
    await b.ocen("[document.getElementById('fd-e-szerokosc_geograficzna').value, document.getElementById('fd-e-miejscowosc').value, AED.ui.formularz.stan.edycja.rekord.zrodlo_wspolrzednych]"));
  ok(await b.ocen("document.activeElement.id === 'fd-geo-stan'"), 'po wyborze fokus na komunikacie o wyborze');
  ok(await b.ocen("!!document.querySelector('#fd-edytor .mapa-aed')"), 'znacznik urządzenia na mapie');

  // mapa z klawiatury: strzałka przesuwa, + przybliża, „Ustaw punkt w środku mapy”
  await b.ocen("document.querySelector('#fd-edytor .leaflet-container').focus()");
  ok(await b.ocen("document.activeElement.classList.contains('leaflet-container') && document.activeElement.getAttribute('aria-label').length > 0"), 'mapa przyjmuje fokus i ma etykietę');
  const zoom0 = await b.ocen('AED.ui.formularz && document.querySelector("#fd-edytor .leaflet-container") && 0');
  await b.klawisz('-');
  await b.pauza(400);
  await b.klawisz('ArrowRight');
  await b.pauza(400);
  await b.ocen("document.getElementById('fd-mapa-srodek').click()");
  await b.pauza(200);
  const lat = await b.ocen("document.getElementById('fd-e-szerokosc_geograficzna').value");
  const lon = await b.ocen("document.getElementById('fd-e-dlugosc_geograficzna').value");
  ok(lon !== '21.765034' && await b.ocen("AED.ui.formularz.stan.edycja.rekord.zrodlo_wspolrzednych === 'wskazanie_na_mapie'"),
    'klawiatura przesuwa mapę; „Ustaw punkt w środku mapy” ustawia współrzędne i źródło „wskazanie_na_mapie”', { lat: lat, lon: lon, zoom0: zoom0 });
  // wskazanie punktu przy niezgodnym adresie → ostrzeżenie z przyciskiem „Uzupełnij adres z punktu”
  await wpiszPole('fd-e-miejscowosc', 'Rymanów');
  await b.ocen("document.getElementById('fd-mapa-srodek').click()");
  await b.czekaj("!!document.getElementById('fd-geo-uzupelnij')", 8000);
  ok(await b.ocen("/nie pasuje do punktu/.test(document.getElementById('fd-geo-stan').textContent)"), 'punkt niezgodny z adresem: ostrzeżenie w obszarze wyszukiwania');
  await b.ocen("document.getElementById('fd-geo-uzupelnij').click()");
  ok(await b.ocen("document.getElementById('fd-e-miejscowosc').value === 'Krosno' && document.activeElement.id === 'fd-geo-stan'"), '„Uzupełnij adres z punktu” poprawia miejscowość');
  // ręczne współrzędne
  await wpiszPole('fd-e-szerokosc_geograficzna', '49,68875');
  await wpiszPole('fd-e-dlugosc_geograficzna', '21.76510');
  ok(await b.ocen("document.getElementById('fd-e-szerokosc_geograficzna').value === '49.68875' && !AED.ui.formularz.stan.edycja.rekord.zrodlo_wspolrzednych && /nieznane/.test(document.getElementById('fd-wsp-zrodlo').textContent)"),
    'ręczne współrzędne: przecinek zamieniony na kropkę, automatyczne źródło wyczyszczone');
  await wpiszPole('fd-e-szerokosc_geograficzna', '149.5');
  ok(await b.ocen("document.getElementById('fd-e-szerokosc_geograficzna').getAttribute('aria-invalid') === 'true'"), 'współrzędna poza Polską – błąd przy polu');
  await wpiszPole('fd-e-szerokosc_geograficzna', '49.68875');

  // pozostałe pola obowiązkowe
  await wpiszPole('fd-e-opis_lokalizacji', 'Hol główny, obok portierni, parter.');
  await wybierz('fd-e-dostepnosc', 'publiczna_w_godzinach');
  await wybierz('fd-e-sposob_dostepu', 'otwarta_szafka');
  await b.ocen("document.querySelector('#fd-edytor button[type=submit]').click()");
  await b.pauza(200);
  const zaleznosc = await b.ocen("document.getElementById('fd-e-godziny_dostepnosci').getAttribute('aria-invalid') === 'true'");
  ok(zaleznosc, 'pole zależne: godziny wymagane przy dostępności „w godzinach”');
  await wpiszPole('fd-e-godziny_dostepnosci', 'Mo-Fr 07:00-17:00');
  await b.ocen("document.querySelector('#fd-edytor button[type=submit]').click()");
  await b.czekaj("document.querySelectorAll('.fd-urzadzenie').length === 1 && document.activeElement.id === 'fd-u-0-h'");
  ok(await b.ocen("/Kompletne/.test(document.querySelector('.fd-urzadzenie').textContent)"), 'zapisano urządzenie: na liście, „Kompletne”, fokus na nim');

  // duplikuj → zapisz
  await b.ocen("[...document.querySelectorAll('.fd-urzadzenie button')].find(function (x) { return /Duplikuj/.test(x.textContent); }).click()");
  await b.czekaj("document.activeElement && document.activeElement.id === 'h-fd-edytor'");
  ok(await b.ocen("/\\(kopia\\)/.test(document.getElementById('fd-e-nazwa').value) && document.getElementById('fd-e-miejscowosc').value === 'Krosno'"), 'duplikat: kopia nazwy i adresu');
  await wpiszPole('fd-e-kondygnacja', '1');
  await b.ocen("document.querySelector('#fd-edytor button[type=submit]').click()");
  await b.czekaj("document.querySelectorAll('.fd-urzadzenie').length === 2");
  ok(await b.ocen("AED.ui.formularz.stan.urzadzenia[0].id_aed !== AED.ui.formularz.stan.urzadzenia[1].id_aed"), 'duplikat ma własny identyfikator id_aed');

  // usuń → cofnij
  await b.ocen("[...document.querySelectorAll('.fd-urzadzenie')][1].querySelector('button:last-child').click()");
  await b.pauza(100);
  ok(await b.ocen("document.querySelectorAll('.fd-urzadzenie').length === 1 && document.activeElement.id === 'fd-cofnij-btn'"), 'usunięcie: fokus na „Cofnij usunięcie”');
  await b.klawisz('Enter');
  await b.pauza(100);
  ok(await b.ocen("document.querySelectorAll('.fd-urzadzenie').length === 2"), 'cofnięcie usunięcia przywraca urządzenie');

  // 320 px z otwartym edytorem
  await b.ocen("document.querySelector('.fd-urzadzenie button').click()");
  await b.czekaj("!!document.querySelector('#fd-edytor .leaflet-container')");
  await b.szerokosc(320);
  await b.pauza(300);
  const w = await b.ocen('document.documentElement.scrollWidth');
  ok(w <= 320, '320 px – formularz z mapą bez przewijania w poziomie', w);
  await t.zrzut('formularz-edytor-320');
  await b.szerokosc(1280);
  await b.ocen("[...document.querySelectorAll('#fd-edytor button')].find(function (x) { return x.textContent === 'Anuluj'; }).click()");

  // szkic po odświeżeniu strony
  await b.pauza(600);
  await b.ocen("location.hash = '#start'; true");
  await b.pauza(100);
  await b.przeladuj();
  await wczytajAtrape();
  await b.ocen("location.hash = '#formularz'; true");
  await b.czekaj("document.querySelectorAll('.fd-urzadzenie').length === 2");
  ok(await b.ocen("document.getElementById('fd-d-dysponent_nazwa').value === 'Szkoła Podstawowa nr 1 w Krośnie' && /Przywrócono/.test(document.getElementById('fd-szkic-stan').textContent)"),
    'szkic przywrócony po odświeżeniu (dysponent i 2 urządzenia)');

  // dodaj do scalania → krok 1
  await b.ocen("document.getElementById('fd-do-scalania').click()");
  await b.czekaj("location.hash === '#zrodla'");
  const z = await b.ocen("AED.store.zrodla.filter(function (x) { return x.typ === 'FORMULARZ'; }).map(function (x) { return { kod: x.kod, n: x.wiersze.length }; })");
  ok(z.length === 1 && z[0].n === 2, '„Dodaj do scalania”: źródło FORMULARZ z 2 urządzeniami w rejestrze, przejście do kroku 1', z);
  ok(await b.ocen("/" + (z[0] ? z[0].kod : 'brak') + "/.test(document.getElementById('rejestr').textContent)"), 'źródło widoczne w rejestrze źródeł');
};
