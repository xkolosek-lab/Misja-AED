/* Podstawy: wczytanie bibliotek, klawiatura (link „Przejdź do treści”, menu), 320 px bez przewijania w poziomie. */
'use strict';
module.exports = async function (t) {
  const { b, adres, ok } = t;
  await b.czekaj("document.readyState === 'complete' && !!window.AED && !!AED.router");
  ok(await b.ocen("typeof Papa !== 'undefined' && typeof XLSX !== 'undefined' && typeof L !== 'undefined' && L.version === '1.9.4'"),
    'biblioteki wczytane (PapaParse, SheetJS, Leaflet 1.9.4)');
  ok(await b.ocen("!!(AED.ui.mapa && AED.ui.formularz && AED.ui.wynik && AED.ui.duplikaty)"), 'moduły interfejsu wczytane');
  ok(await b.ocen("!/openstreetmap|overpass|odbl/i.test(document.documentElement.outerHTML)"), 'strona nie wspomina OpenStreetMap / Overpass / ODbL');
  // nazwa serwisu i oznaczenie prototypu (strona nie może udawać serwisu rządowego)
  ok(await b.ocen("/^Namiar na puls$/i.test(document.title)"), 'tytuł strony zawiera nazwę „Namiar na puls”', await b.ocen('document.title'));
  ok(await b.ocen("document.querySelector('.brand').textContent.trim() === 'Namiar na puls'"),
    'nagłówek: marka „Namiar na puls”');
  ok(await b.ocen("!document.querySelector('img[src*=\"Herb\" i], img[src*=\"godlo\" i]')"), 'brak godła RP na stronie');
  ok(await b.ocen("!/Misja AED</.test(document.body.outerHTML) && !/Misja AED(?! –)/.test(document.querySelector('.site-header').textContent)"), 'stara nazwa „Misja AED” nie jest marką strony');
  ok(await b.ocen("document.fonts.check('16px \"Open Sans\"') && getComputedStyle(document.body).fontFamily.indexOf('Open Sans') >= 0"), 'krój Open Sans (lokalna kopia)');
  // każdy skrypt dołączony dokładnie raz (podwójny gov.js resetował stan)
  const duble = await b.ocen("(function(){ const n = {}; document.querySelectorAll('script[src]').forEach(function (s) { const k = s.getAttribute('src'); n[k] = (n[k] || 0) + 1; }); return Object.keys(n).filter(function (k) { return n[k] > 1; }); })()");
  ok(!duble.length, 'każdy <script src> dołączony tylko raz', duble);
  ok(await b.ocen("(function(){ const s = getComputedStyle(document.querySelector('.brand__portal'), '::before'); return s.content !== 'none' && s.backgroundColor === 'rgb(213, 35, 63)' && s.width === '2px'; })()"), 'nagłówek: czerwona pionowa kreska jak na gov.pl między marką a „Dane o defibrylatorach AED”');
  // tokeny kolorów jak gov.pl
  ok(await b.ocen("getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim() === '#0052a5' && getComputedStyle(document.querySelector('.btn--primary')).backgroundColor === 'rgb(0, 82, 165)'"),
    'kolor podstawowy #0052a5 (gov.pl) na przycisku głównym');
  // proste szablony dla dysponentów: najpierw Excel, potem CSV, pełny wzorzec jako drugorzędny
  ok(await b.ocen("(function(){ const k = document.querySelector('section[data-route=start] .pobierz-szablon'); if (!k) return false; const a = k.querySelectorAll('a[download]'); return a[0].getAttribute('href') === 'wzorzec/formularz_dysponenta_AED.xlsx' && a[1].getAttribute('href') === 'wzorzec/formularz_dysponenta_AED.csv' && !!k.querySelector('details a[href=\"wzorzec/wzorcowy_zakres_danych_AED.xlsx\"]'); })()"),
    'start: „Pobierz prosty formularz (Excel)” pierwszy, potem CSV, pełny wzorzec w <details>');
  const szablony = await b.ocen("Promise.all(['wzorzec/formularz_dysponenta_AED.xlsx','wzorzec/formularz_dysponenta_AED.csv'].map(function (u) { return fetch(u, { method: 'HEAD' }).then(function (r) { return r.status; }); }))");
  ok(szablony.every(function (x) { return x === 200; }), 'pliki prostych formularzy istnieją', szablony);

  // klawiatura: pierwszy Tab – link „Przejdź do treści”, Enter – fokus na nagłówku ekranu
  await b.ocen("document.activeElement && document.activeElement.blur(); window.scrollTo(0,0); true");
  await b.klawisz('Tab');
  ok(await b.ocen("document.activeElement.classList.contains('skip-link')"), 'pierwszy Tab: link „Przejdź do treści”',
    await b.ocen("document.activeElement.outerHTML.slice(0,80)"));
  await b.klawisz('Enter');
  ok(await b.ocen("document.activeElement.id === 'h-start'"), 'Enter na linku przenosi fokus na nagłówek H1', await b.ocen('document.activeElement.id'));
  // Tab dalej prowadzi do elementów treści (kolejność zgodna z układem)
  await b.klawisz('Tab');
  ok(await b.ocen("!!document.activeElement.closest('main')"), 'kolejny Tab – element w treści głównej');

  // menu: przejście do formularza z klawiatury
  await b.ocen("document.querySelector('.top-nav a[href=\"#formularz\"]').focus()");
  await b.klawisz('Enter');
  await b.czekaj("location.hash === '#formularz' && document.activeElement.id === 'h-formularz'");
  ok(true, 'menu główne działa z klawiatury, fokus na H1 formularza');

  // krok 1: karta formularza prowadzi do #formularz, bez zaślepki „część 5”
  await b.idz(adres + 'index.html#zrodla');
  ok(await b.ocen("!!document.querySelector('#zrodla, section[data-route=zrodla]') && !!document.querySelector('section[data-route=zrodla] a[href=\"#formularz\"]')"),
    'krok 1: karta „Formularz” ma link do formularza');
  ok(await b.ocen("!/Dostępne w części 5/.test(document.body.textContent)"), 'krok 1: brak odznaki „Dostępne w części 5”');

  // 320 px (WCAG 1.4.10) na ekranach bez danych
  await b.szerokosc(320);
  for (const trasa of ['start', 'zrodla', 'formularz']) {
    await b.ocen("location.hash = '#" + trasa + "'; true");
    await b.pauza(250);
    const w = await b.ocen('document.documentElement.scrollWidth');
    ok(w <= 320, '320 px – ekran „' + trasa + '” bez przewijania w poziomie', w);
  }
  await t.zrzut('formularz-320');
  await b.szerokosc(1280);
};
