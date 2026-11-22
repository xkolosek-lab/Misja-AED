/* Dostępność: automatyczny audyt axe-core (tests/vendor/axe-core, MPL-2.0) z regułami WCAG 2.0 / 2.1 / 2.2 na poziomach A i AA
   na wszystkich ekranach – z danymi (kroki 1–4) i bez – przy szerokości 1280 px (komputer) i 360 px (telefon).
   Do tego: tytuł strony opisuje bieżący ekran (WCAG 2.4.2) i przypięty pasek „Wstecz / Następny krok” na telefonie
   nie zasłania elementu z fokusem (WCAG 2.2, 2.4.11). */
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const b = t.b, ok = t.ok;
  const FIX = path.join(t.korzen, 'tests', 'fixtures');
  const AXE = fs.readFileSync(path.join(t.korzen, 'tests', 'vendor', 'axe-core', 'axe.min.js'), 'utf8');
  const TAGI = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

  async function audyt(opis) {
    await b.ocen('(function(){ if (!window.axe) { ' + AXE + '\n } return true; })()');
    const wynik = await b.ocen('axe.run(document, { runOnly: { type: "tag", values: ' + JSON.stringify(TAGI) + ' }, resultTypes: ["violations"] })' +
      '.then(function (r) { return r.violations.map(function (v) { return v.id + ' + "' (' + v.impact + '): ' + v.help + ' – ' + " +
      'v.nodes.slice(0, 3).map(function (n) { return n.target.join(" "); }).join(" | "); }); })');
    ok(wynik.length === 0, 'axe (WCAG 2.2 A/AA): ' + opis, wynik);
  }

  async function ekran(trasa, czekaj) {
    await b.ocen("location.hash = '#" + trasa + "'; true");
    await b.czekaj(czekaj || "!document.querySelector('section[data-route=\"" + trasa + "\"]').hidden");
    await b.pauza(300);
  }

  // czysta strona (poprzednie testy zostawiają źródła w pamięci)
  await b.ocen('try { localStorage.clear(); } catch (e) {} true');
  await b.przeladuj();
  await b.czekaj('!!window.AED && !!AED.store');

  // ---- ekrany bez danych
  for (const szer of [1280, 360]) {
    await b.szerokosc(szer);
    for (const trasa of ['start', 'zrodla', 'mapowanie', 'walidacja', 'wynik', 'formularz', 'nie-ma-takiej']) {
      await ekran(trasa, trasa === 'nie-ma-takiej' ? "!document.querySelector('section[data-route=\"404\"]').hidden" : null);
      await audyt(trasa + ' (bez danych, ' + szer + ' px)');
    }
  }

  // ---- tytuł strony opisuje ekran (2.4.2)
  await b.szerokosc(1280);
  await ekran('start');
  ok(await b.ocen("document.title === 'Namiar na Puls'"), 'tytuł: start = „Namiar na Puls”', await b.ocen('document.title'));
  await ekran('mapowanie');
  ok(await b.ocen("/^Krok 2 z 4.* – Namiar na Puls$/.test(document.title)"), 'tytuł: krok 2 opisuje ekran', await b.ocen('document.title'));
  await ekran('formularz');
  ok(await b.ocen("/^Formularz dysponenta.* – Namiar na Puls$/.test(document.title)"), 'tytuł: formularz dysponenta opisuje ekran', await b.ocen('document.title'));

  // ---- kroki 1–4 z danymi
  await ekran('zrodla');
  await b.pliki('#plik-input', [path.join(FIX, 'krosno_dgp3624.csv')]);
  await b.czekaj('AED.store.zrodla.length === 1 && AED.store.zrodla[0].wiersze.length > 0', 30000);
  for (const szer of [1280, 360]) { await b.szerokosc(szer); await audyt('zrodla (z plikiem, ' + szer + ' px)'); }
  await b.szerokosc(1280);
  await b.ocen("AED.store.zrodla.forEach(function (z) { AED.store.aktualizujZrodlo(z.id, { licencja: 'CC0-1.0', dysponent: 'Urząd Miasta Krosna' }); }); true");
  await b.ocen("document.getElementById('dalej-mapowanie').click()");
  await b.czekaj("location.hash === '#mapowanie'");
  await b.pauza(300);
  for (const szer of [1280, 360]) { await b.szerokosc(szer); await audyt('mapowanie (z danymi, ' + szer + ' px)'); }
  await b.szerokosc(1280);
  await b.ocen("document.getElementById('dalej-walidacja').click()");
  await b.czekaj("location.hash === '#walidacja' && !document.getElementById('wal-tresc').hidden", 60000);
  await b.ocen("document.getElementById('dup-szukaj').click(); true");
  await b.czekaj('!!AED.store.duplikaty', 60000);
  await b.pauza(300);
  for (const szer of [1280, 360]) { await b.szerokosc(szer); await audyt('walidacja i duplikaty (z danymi, ' + szer + ' px)'); }
  await b.szerokosc(1280);
  await ekran('wynik', "!document.getElementById('wyn-tresc').hidden && !!document.getElementById('wyn-m-form')");
  for (const szer of [1280, 360]) { await b.szerokosc(szer); await audyt('wynik i eksport (z danymi, ' + szer + ' px)'); }

  // ---- telefon: przypięty pasek kroków nie zasłania fokusu (2.4.11)
  await b.szerokosc(360);
  await ekran('wynik', "!document.getElementById('wyn-tresc').hidden && !!document.getElementById('wyn-m-form')");
  const zaslonione = await b.ocen("(function(){" +
    " const pasek = document.querySelector('section[data-route=\"wynik\"] .step-actions');" +
    " const pola = Array.from(document.querySelectorAll('section[data-route=\"wynik\"] input:not([type=hidden]), section[data-route=\"wynik\"] select, section[data-route=\"wynik\"] textarea, section[data-route=\"wynik\"] button'))" +
    "   .filter(function (el) { return el.offsetParent !== null && !pasek.contains(el); });" +
    " const zle = [];" +
    " pola.forEach(function (el) {" +
    "   window.scrollTo(0, 0); el.focus();" +
    "   const r = el.getBoundingClientRect(), p = pasek.getBoundingClientRect();" +
    "   if (r.bottom > p.top + 1 && r.top < p.bottom) zle.push((el.id || el.name || el.textContent.trim().slice(0, 30)) + ' ' + Math.round(r.top) + '/' + Math.round(p.top));" +
    " });" +
    " return { sprawdzone: pola.length, zle: zle.slice(0, 5) }; })()");
  ok(zaslonione.sprawdzone > 5 && zaslonione.zle.length === 0, '360 px: przypięty pasek „Wstecz / Następny krok” nie zasłania (nawet częściowo) elementu z fokusem (' + zaslonione.sprawdzone + ' elementów)', zaslonione);
  await b.szerokosc(1280);
};
