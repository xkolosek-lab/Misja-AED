/* Formularz dysponenta (#formularz): dane dysponenta raz, potem lista urządzeń AED.
   Logika pól (kolejność, normalizacja, walidacja, CSV, szkic, dodanie do scalania) – AED.formularz;
   wyszukiwanie adresów – AED.geokoder; mapa – AED.ui.mapa. Tu jest tylko interfejs.
   Wpisy użytkownika i odpowiedzi geokodera trafiają do DOM wyłącznie przez h() (textContent / atrybuty).
   WCAG: etykiety i opisy przy każdym polu, błędy przy polu i w podsumowaniu z linkami, autocomplete na polach
   kontaktowych, brak limitów czasu, mapa zawsze z alternatywą (wyszukiwanie adresu i pola współrzędnych). */
(function (AED) {
  'use strict';
  const { h, odznaka, oglos, liczba, odmiana, ikona, pobierz } = AED.dom;
  const store = AED.store;

  const W = AED.wzorzec;
  const SCHEMAT = {};
  W.schema.fields.forEach(function (p) { SCHEMAT[p.name] = p; });

  // pola dysponenta – wpisywane raz, kopiowane do każdego urządzenia
  const DYSP = ['dysponent_nazwa', 'dysponent_typ', 'dysponent_regon', 'telefon_kontaktowy', 'email_kontaktowy'];
  const AUTOCOMPLETE = { dysponent_nazwa: 'organization', telefon_kontaktowy: 'tel', email_kontaktowy: 'email' };
  const TYP_POLA = { telefon_kontaktowy: 'tel', email_kontaktowy: 'email' };
  // pola nadawane automatycznie (nie pokazujemy ich w formularzu urządzenia)
  const AUTO = { id_aed: 1, zrodlo_danych: 1, licencja_rekordu: 1, data_aktualizacji_rekordu: 1, zrodlo_id_rekordu: 1 };
  const WSP = ['szerokosc_geograficzna', 'dlugosc_geograficzna'];
  const OPOZNIENIE_ZAPISU = 400; // ms – autozapis szkicu po zmianie
  const OPOZNIENIE_ODWROTNE = 1200; // ms – geokodowanie odwrotne po ostatnim wskazaniu punktu (UUG blokuje za nadużycie)
  const KLUCZ_UI_STARY = 'aed.formularz.ui.v1'; // dawny osobny zapis stanu interfejsu – tylko do migracji
  // Uproszczony widok: na start tylko pola obowiązkowe, warunkowe i adres; reszta w <details> „więcej (opcjonalnie)”
  const ZAWSZE_WIDOCZNE = { ulica: 1, numer_budynku: 1, kod_pocztowy: 1, cecha_ulicy: 1, kondygnacja: 1, dysponent_typ: 1,
    telefon_kontaktowy: 1, email_kontaktowy: 1 };
  // krótsze podpowiedzi w interfejsie (logika pól bez zmian)
  const KROTKO = {
    szerokosc_geograficzna: { pomoc: 'Uzupełni się po wyborze adresu lub punktu na mapie. Np. 50.061430.' },
    dlugosc_geograficzna: { pomoc: 'Uzupełni się po wyborze adresu lub punktu na mapie. Np. 19.936580.' },
    nazwa: { pomoc: 'Np. „Szkoła Podstawowa nr 1 – hol główny”.' },
    ulica: { pomoc: 'Bez „ul.”. Brak ulic – zostaw puste.' },
    godziny_dostepnosci: { pomoc: 'Np. „pn–pt 7:00–17:00” albo „całodobowo”.' },
    instrukcja_dostepu: { pomoc: 'Kto ma klucz lub kod. Nie wpisuj samego kodu.' },
    dysponent_nazwa: { pomoc: 'Pełna nazwa, np. „Urząd Miasta Krosna”.' },
    telefon_kontaktowy: { etykieta: 'Telefon (instytucji)', pomoc: 'Np. sekretariat, portiernia.' },
    email_kontaktowy: { etykieta: 'E-mail do zgłaszania zmian', pomoc: 'Adres funkcyjny, nie imienny.' }
  };
  function podstawowe(p) { return p.wymagane || !!p.warunek || !!ZAWSZE_WIDOCZNE[p.pole] || WSP.indexOf(p.pole) >= 0; }

  const st = {
    dysponent: {},
    licencja: 'CC0-1.0',
    urzadzenia: [],
    edycja: null,          // { indeks: liczba|null (nowe), rekord, dotkniete: Set, problemyWpisu: {pole: tekst}, proba: bool }
    dodane: null,          // { id, kod } źródła dodanego do scalania
    usuniete: null,        // { rekord, indeks } – do cofnięcia
    zapisanoSzkic: null,   // Date
    zainicjowano: false
  };
  let mapaEd = null, znacznik = null, geoKontroler = null, odwrKontroler = null, timerZapisu = null;

  function $(id) { return document.getElementById(id); }
  function F() { return AED.formularz || null; }
  function G() { return AED.geokoder || null; }
  function pusta(v) { return v === null || v === undefined || v === ''; }
  function kopia(o) { return JSON.parse(JSON.stringify(o)); }

  // ------------------------------------------------------------------ opis pól (kontrakt AED.formularz.POLA_FORMULARZA)
  /** Opis pola z POLA_FORMULARZA uzupełniony danymi ze schematu wzorca (etykieta, pomoc, słownik, obowiązkowość). */
  function opisPola(x, grupa) {
    const nazwa = typeof x === 'string' ? x : (x.pole || x.name || x.klucz);
    const s = SCHEMAT[nazwa] || { title: nazwa, type: 'string', constraints: {}, aed: {} };
    const o = typeof x === 'string' ? {} : x;
    const a = s.aed || {}, c = s.constraints || {};
    let slownik = o.slownik;
    if (typeof slownik === 'string') slownik = W.slowniki[slownik];
    if (!slownik && a.slownik && W.slowniki[a.slownik]) slownik = W.slowniki[a.slownik];
    if (!slownik && c.enum) slownik = c.enum.map(function (k) { return { kod: k, etykieta: k }; });
    const obow = a.obowiazkowosc;
    const maks = o.maks || c.maxLength || null;
    // rodzaj kontrolki: typy z AED.formularz (tak_nie, data, tekst_dlugi, liczba, wspolrzedna…) albo typ ze schematu
    const typ = o.typ || '';
    const rodzaj = slownik ? 'select'
      : (typ === 'tak_nie' || s.type === 'boolean') ? 'boolean'
        : (typ === 'data' || s.type === 'date') ? 'date'
          : (typ === 'tekst_dlugi' || (maks && maks >= 300)) ? 'textarea'
            : (s.type === 'integer') ? 'integer'
              : (typ === 'liczba' || typ === 'wspolrzedna' || s.type === 'number') ? 'number' : 'text';
    const k = KROTKO[nazwa] || {};
    return {
      pole: nazwa,
      etykieta: k.etykieta || o.etykieta || o.title || s.title || nazwa,
      pomoc: k.pomoc || o.pomoc || o.opis || s.description || '',
      warunek: o.warunek || null,
      format: o.format || (o.pomoc || slownik || rodzaj === 'boolean' || rodzaj === 'date' ? '' : a.format) || '',
      rodzaj: rodzaj,
      slownik: slownik || null,
      wymagane: o.wymagane !== undefined ? !!o.wymagane : obow === 'O',
      zalecane: o.zalecane !== undefined ? !!o.zalecane : (obow === 'Z' || obow === 'W'),
      maks: maks,
      grupa: o.grupa || grupa || a.grupa || 'Inne'
    };
  }
  /** Nazwa i opis grupy (AED.formularz.GRUPY: [{id, nazwa, opis}]). */
  function grupaInfo(id) {
    const g = ((F() && F().GRUPY) || []).find(function (x) { return x.id === id || x.nazwa === id; });
    return g ? { id: g.id, nazwa: g.nazwa, opis: g.opis || '' } : { id: id, nazwa: id, opis: '' };
  }

  /** Grupy pól urządzenia: [{ nazwa, pola: [opis] }] – bez pól dysponenta i pól automatycznych. */
  function grupyUrzadzenia() {
    const zrodlo = (F() && F().POLA_FORMULARZA) || [];
    const tech = (F() && F().POLA_TECHNICZNE) || [];
    const grupy = [];
    const dodaj = function (nazwaGrupy, opis) {
      if (DYSP.indexOf(opis.pole) >= 0 || AUTO[opis.pole] || tech.indexOf(opis.pole) >= 0) return;
      const info = grupaInfo(nazwaGrupy);
      let g = grupy.find(function (x) { return x.id === info.id; });
      if (!g) { g = { id: info.id, nazwa: info.nazwa, opis: info.opis, pola: [] }; grupy.push(g); }
      g.pola.push(opis);
    };
    zrodlo.forEach(function (x) {
      if (x && Array.isArray(x.pola)) {
        const n = x.grupa || x.nazwa || x.legenda || 'Inne';
        x.pola.forEach(function (p) { const o = opisPola(p, n); dodaj(n, o); });
      } else if (x) {
        const o = opisPola(x); dodaj(o.grupa, o);
      }
    });
    // grupa dysponenta jest wpisywana raz – pozostałe w niej pola urządzenia (np. numer inwentarzowy) przenosimy do grupy „urządzenie”
    const gd = grupy.find(function (g) { return g.id === 'dysponent'; });
    if (gd && grupy.length > 1) {
      const cel = grupy.find(function (g) { return g.id === 'urzadzenie'; }) || grupy.filter(function (g) { return g !== gd; }).pop();
      Array.prototype.push.apply(cel.pola, gd.pola);
      gd.pola = [];
    }
    return grupy.filter(function (g) { return g.pola.length; });
  }
  function opisyDysponenta() {
    const wszystkie = {};
    ((F() && F().POLA_FORMULARZA) || []).forEach(function (x) {
      (x && Array.isArray(x.pola) ? x.pola : [x]).forEach(function (p) { const o = opisPola(p); wszystkie[o.pole] = o; });
    });
    return DYSP.map(function (n) { return wszystkie[n] || opisPola(n); });
  }

  // ------------------------------------------------------------------ wartości i walidacja
  function tekstWartosci(v) {
    if (v === null || v === undefined) return '';
    return String(v);
  }
  function normalizuj(pole, tekst) {
    try {
      const w = F().normalizujWpis(pole, tekst) || {};
      const pr = w.problem;
      return { wartosc: w.wartosc === undefined ? null : w.wartosc, cecha_ulicy: w.cecha_ulicy || null,
        problem: pr ? (typeof pr === 'string' ? pr : (pr.komunikat || String(pr))) : null };
    } catch (e) { console.error(e); return { wartosc: tekst, problem: null }; }
  }
  /** Rekord urządzenia z dołączonymi danymi dysponenta i licencją. */
  function pelny(r) {
    const x = Object.assign({}, r);
    DYSP.forEach(function (k) { x[k] = pusta(st.dysponent[k]) ? null : st.dysponent[k]; });
    x.licencja_rekordu = st.licencja;
    return x;
  }
  function waliduj(r) {
    try { return F().waliduj(pelny(r)) || []; } catch (e) { console.error(e); return []; }
  }
  function bledy(lista) { return lista.filter(function (p) { return p.poziom !== 'ostrzezenie'; }); }
  /** Błędy urządzenia w polach, które użytkownik może poprawić w formularzu urządzenia. */
  function bledyUrzadzenia(r) {
    const pola = polaEdytora();
    return bledy(waliduj(r)).filter(function (p) { return pola.has(p.pole); });
  }

  // ------------------------------------------------------------------ szkic (tylko ta przeglądarka)
  function zaplanujZapis() {
    clearTimeout(timerZapisu);
    timerZapisu = setTimeout(zapiszSzkic, OPOZNIENIE_ZAPISU);
  }
  function zapiszSzkic() {
    clearTimeout(timerZapisu);
    if (!F() || !F().zapiszSzkic) return;
    let ok = true;
    try {
      // rekordy urządzeń (z danymi dysponenta i licencją) + stan interfejsu: dane dysponenta wpisane przed dodaniem
      // urządzeń, licencja i otwarte, niezapisane urządzenie – jeden zapis modułu formularza
      if (F().zapiszSzkic(st.urzadzenia.map(pelny), { dysponent: st.dysponent, licencja: st.licencja,
        edycja: st.edycja ? { indeks: st.edycja.indeks, wstawPo: st.edycja.wstawPo, rekord: st.edycja.rekord } : null }) === false) ok = false;
    } catch (e) { console.warn('[AED] zapis szkicu:', e); ok = false; }
    st.zapisanoSzkic = ok ? new Date() : null;
    odswiezPostep();
    const el = $('fd-szkic-stan');
    if (el) {
      el.textContent = '';
      el.append(ok ? 'Szkic zapisany w tej przeglądarce o ' + st.zapisanoSzkic.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) + '.'
        : 'Nie udało się zapisać szkicu (przeglądarka blokuje zapis danych). Nie zamykaj strony przed pobraniem pliku.');
    }
  }
  function wczytajSzkic() {
    if (!F() || !F().wczytajSzkic) return false;
    let lista = null, ui = null;
    try { lista = F().wczytajSzkic(); } catch (e) { console.error(e); }
    try { ui = F().wczytajStanSzkicu ? F().wczytajStanSzkicu() : null; } catch (e) { ui = null; }
    // migracja: stan interfejsu zapisany wcześniej pod osobnym kluczem – odczyt raz i usunięcie
    try {
      const stary = localStorage.getItem(KLUCZ_UI_STARY);
      if (stary !== null) { if (!ui) ui = JSON.parse(stary); localStorage.removeItem(KLUCZ_UI_STARY); }
    } catch (e) { /* brak dostępu do pamięci przeglądarki */ }
    lista = Array.isArray(lista) ? lista : (lista && Array.isArray(lista.urzadzenia) ? lista.urzadzenia : []);
    if (ui && ui.dysponent) st.dysponent = Object.assign({}, ui.dysponent);
    else if (lista.length) DYSP.forEach(function (k) { if (!pusta(lista[0][k])) st.dysponent[k] = lista[0][k]; });
    if (ui && ui.licencja) st.licencja = ui.licencja;
    else if (lista.length && lista[0].licencja_rekordu) st.licencja = lista[0].licencja_rekordu;
    // dane dysponenta trzymamy raz – w rekordach urządzeń dołączamy je dopiero przy eksporcie
    st.urzadzenia = lista.map(function (r) { const x = Object.assign({}, r); DYSP.forEach(function (k) { delete x[k]; }); return x; });
    if (ui && ui.edycja && ui.edycja.rekord) {
      const idx = typeof ui.edycja.indeks === 'number' && ui.edycja.indeks < st.urzadzenia.length ? ui.edycja.indeks : null;
      st.edycja = { indeks: idx, wstawPo: ui.edycja.wstawPo, rekord: ui.edycja.rekord, dotkniete: new Set(), problemyWpisu: {}, proba: false };
    }
    return !!(st.urzadzenia.length || st.edycja || st.dysponent.dysponent_nazwa);
  }

  // ------------------------------------------------------------------ kontrolki pól
  function idPola(prefiks, pole) { return prefiks + pole; }

  /** Kontrolka pola. o: { prefiks, wartosc, onZmiana(pole, tekst) } */
  function kontrolka(p, o) {
    const id = idPola(o.prefiks, p.pole);
    const opisIds = [p.pomoc || p.format || p.warunek ? id + '-pomoc' : null, id + '-blad'].filter(Boolean).join(' ');
    const gw = p.wymagane ? [h('span', { class: 'wymagane', 'aria-hidden': 'true' }, ' *'), h('span', { class: 'visually-hidden' }, ' (wymagane)')]
      : p.zalecane ? h('span', { class: 'meta fd-zalecane' }, ' (zalecane)') : null;
    const pomoc = p.pomoc || p.format || p.warunek
      ? h('p', { class: 'hint', id: id + '-pomoc' }, p.pomoc, p.format && p.pomoc.indexOf(p.format) < 0 ? [p.pomoc ? ' ' : '', 'Format: ', p.format, '.'] : null,
        p.warunek ? [p.pomoc || p.format ? ' ' : '', 'Wymagane ', p.warunek, '.'] : null)
      : null;
    const blad = h('p', { class: 'field-error', id: id + '-blad', hidden: true });
    const v = o.wartosc;
    const zmiana = function (tekst) { o.onZmiana(p.pole, tekst); };

    if (p.rodzaj === 'boolean') {
      const opcje = [['true', 'Tak'], ['false', 'Nie']].concat(p.wymagane ? [] : [['', 'Brak informacji']]);
      return h('fieldset', { class: 'radio-group field fd-pole', id: id, 'aria-describedby': opisIds, 'data-pole': p.pole },
        h('legend', null, p.etykieta, gw),
        pomoc,
        h('div', { class: 'fd-tak-nie' }, opcje.map(function (x, i) {
          const idr = id + '-' + (x[0] || 'brak');
          const zazn = x[0] === '' ? pusta(v) : String(v) === x[0];
          return h('div', { class: 'radio' },
            h('input', { type: 'radio', name: id, id: idr, value: x[0], checked: zazn, 'data-pierwszy': i === 0 ? '1' : null,
              onchange: function (e) { zmiana(e.target.value); } }),
            h('label', { for: idr }, x[1]));
        })),
        blad);
    }
    let ctrl;
    if (p.rodzaj === 'select') {
      ctrl = h('select', { id: id, 'aria-describedby': opisIds, 'aria-required': p.wymagane ? 'true' : null,
        onchange: function (e) { zmiana(e.target.value); } },
        h('option', { value: '' }, '— wybierz —'),
        p.slownik.map(function (s) { return h('option', { value: s.kod, selected: s.kod === v }, s.etykieta || s.kod); }));
    } else if (p.rodzaj === 'date') {
      ctrl = h('input', { type: 'date', id: id, value: tekstWartosci(v), 'aria-describedby': opisIds, 'aria-required': p.wymagane ? 'true' : null,
        onchange: function (e) { zmiana(e.target.value); } });
    } else if (p.rodzaj === 'textarea') {
      ctrl = h('textarea', { id: id, rows: 3, 'aria-describedby': opisIds, 'aria-required': p.wymagane ? 'true' : null,
        lang: /_en$/.test(p.pole) ? 'en' : null, onblur: function (e) { zmiana(e.target.value); } });
      ctrl.value = tekstWartosci(v);
    } else {
      const liczbowe = p.rodzaj === 'number' || p.rodzaj === 'integer';
      ctrl = h('input', {
        type: TYP_POLA[p.pole] || 'text', id: id, value: tekstWartosci(v),
        inputmode: p.rodzaj === 'number' ? 'decimal' : (p.pole === 'dysponent_regon' ? 'numeric' : null),
        autocomplete: AUTOCOMPLETE[p.pole] || (liczbowe ? 'off' : null),
        spellcheck: liczbowe || /kod|regon|telefon|email/.test(p.pole) ? 'false' : null,
        'aria-describedby': opisIds, 'aria-required': p.wymagane ? 'true' : null,
        onblur: function (e) { zmiana(e.target.value); },
        onkeydown: function (e) { if (e.key === 'Enter' && o.naEnter) { e.preventDefault(); zmiana(e.target.value); o.naEnter(); } }
      });
    }
    return h('div', { class: 'field fd-pole', 'data-pole': p.pole },
      h('label', { for: id }, p.etykieta, gw),
      pomoc, ctrl, blad);
  }

  /** Ustawia wartość kontrolki (bez zdarzeń). */
  function ustawKontrolke(prefiks, pole, v) {
    const id = idPola(prefiks, pole);
    const el = $(id);
    if (!el) return;
    if (el.tagName === 'FIELDSET') {
      el.querySelectorAll('input[type=radio]').forEach(function (r) { r.checked = r.value === '' ? pusta(v) : String(v) === r.value; });
    } else el.value = tekstWartosci(v);
  }
  /** Pokazuje problemy przy polu (błąd ma pierwszeństwo przed ostrzeżeniem). */
  function pokazProblemy(prefiks, pole, lista) {
    const id = idPola(prefiks, pole);
    const el = $(id), b = $(id + '-blad');
    if (!el || !b) return;
    b.textContent = '';
    const cel = el.tagName === 'FIELDSET' ? el.querySelectorAll('input') : [el];
    if (!lista.length) {
      b.hidden = true;
      cel.forEach(function (x) { x.removeAttribute('aria-invalid'); });
      return;
    }
    const jestBlad = lista.some(function (x) { return x.poziom !== 'ostrzezenie'; });
    b.className = jestBlad ? 'field-error' : 'field-warn';
    b.append(ikona(jestBlad ? 'err' : 'warn'), ' ', lista.map(function (x) { return (x.poziom === 'ostrzezenie' ? 'Uwaga: ' : '') + x.komunikat; }).join(' '));
    b.hidden = false;
    cel.forEach(function (x) { if (jestBlad) x.setAttribute('aria-invalid', 'true'); else x.removeAttribute('aria-invalid'); });
    otworzSzczegoly(el); // błąd albo ostrzeżenie w polu schowanym pod „Więcej” – pokaż je
  }
  /** Pole schowane w zwiniętym <details> – rozwiń je (błąd, fokus z podsumowania). */
  function otworzSzczegoly(el) {
    const d = el && el.closest && el.closest('details');
    if (d && !d.open) d.open = true;
  }
  /** Pola w podziale: widoczne od razu i „więcej (opcjonalnie)” w <details> (otwarte, gdy coś w nich wpisano). */
  function polaZWiecej(pola, wartosci, rysuj, idSzczegolow, tytulSzczegolow) {
    const widoczne = pola.filter(podstawowe), dodatkowe = pola.filter(function (p) { return !podstawowe(p); });
    if (!dodatkowe.length) return widoczne.map(rysuj);
    const wypelnione = dodatkowe.some(function (p) { return !pusta(wartosci[p.pole]); });
    return widoczne.map(rysuj).concat(h('details', { class: 'fd-wiecej', id: idSzczegolow, open: wypelnione || null },
      h('summary', null, tytulSzczegolow + ' (' + liczba(dodatkowe.length) + ' ' + odmiana(dodatkowe.length, 'pole', 'pola', 'pól') + ', opcjonalnie)'),
      h('div', { class: 'fd-pola' }, dodatkowe.map(rysuj))));
  }
  function fokusPola(prefiks, pole) {
    const el = $(idPola(prefiks, pole));
    if (!el) return false;
    otworzSzczegoly(el);
    const f = el.tagName === 'FIELDSET' ? (el.querySelector('input:checked') || el.querySelector('input')) : el;
    f.focus(); f.scrollIntoView({ block: 'center' });
    return true;
  }

  /** Podsumowanie błędów z linkami do pól (WCAG 3.3.1). */
  function podsumowanieBledow(kontId, idNaglowka, tytul, problemy, prefiks, etykiety) {
    const kont = $(kontId);
    if (!kont) return;
    kont.textContent = '';
    if (!problemy.length) return;
    kont.appendChild(h('div', { class: 'alert alert--err' },
      h('h4', { id: idNaglowka, tabindex: '-1' }, tytul),
      h('ul', null, problemy.map(function (p) {
        return h('li', null, h('a', { href: '#' + idPola(prefiks, p.pole), onclick: function (e) {
          e.preventDefault(); // #hash służy routerowi – przenosimy tylko fokus
          fokusPola(prefiks, p.pole);
        } }, (etykiety[p.pole] ? etykiety[p.pole] + ': ' : '') + p.komunikat));
      }))));
  }

  // ------------------------------------------------------------------ dysponent
  function problemyDysponenta() {
    if (!F()) return [];
    let lista = [];
    try { lista = F().waliduj(pelny(F().pusty ? F().pusty(st.dysponent) : {})) || []; } catch (e) { console.error(e); }
    return lista.filter(function (p) { return DYSP.indexOf(p.pole) >= 0; });
  }
  const dyspDotkniete = new Set();
  const dyspProblemyWpisu = {};
  function zmianaDysponenta(pole, tekst) {
    const n = normalizuj(pole, tekst);
    st.dysponent[pole] = n.wartosc;
    if (n.problem) dyspProblemyWpisu[pole] = n.problem; else delete dyspProblemyWpisu[pole];
    dyspDotkniete.add(pole);
    if (!n.problem && n.wartosc !== null && String(n.wartosc) !== String(tekst).trim()) ustawKontrolke('fd-d-', pole, n.wartosc);
    pokazDysponenta(pole);
    zaplanujZapis();
    odswiezListe(false);
    odswiezPostep();
  }
  function problemyPolaDysp(pole) {
    if (dyspProblemyWpisu[pole]) return [{ pole: pole, poziom: 'blad', komunikat: dyspProblemyWpisu[pole] }];
    return problemyDysponenta().filter(function (p) { return p.pole === pole; });
  }
  function pokazDysponenta(pole) { pokazProblemy('fd-d-', pole, problemyPolaDysp(pole)); }

  function sekcjaDysponenta() {
    const opisy = opisyDysponenta();
    const lic = (W.slowniki.licencja_rekordu || []);
    const OPIS_LIC = {
      'CC0-1.0': 'Bez warunków (domena publiczna). Zalecana – najprostsza dla aplikacji ratunkowych.',
      'CC-BY-4.0': 'Trzeba podać Twoją instytucję jako źródło.'
    };
    return h('section', { class: 'fd-sekcja', 'aria-labelledby': 'h-fd-dysp' },
      h('h2', { id: 'h-fd-dysp', tabindex: '-1' }, '1. Twoja instytucja'),
      h('p', null, 'Wpisz raz – dołączymy to do każdego urządzenia.'),
      h('div', { id: 'fd-d-podsumowanie' }),
      h('form', { id: 'fd-dysp', class: 'fd-form', novalidate: true, 'aria-labelledby': 'h-fd-dysp', onsubmit: function (e) { e.preventDefault(); } },
        polaZWiecej(opisy, st.dysponent, function (p) { return kontrolka(p, { prefiks: 'fd-d-', wartosc: st.dysponent[p.pole], onZmiana: zmianaDysponenta }); },
          'fd-d-wiecej', 'Więcej o instytucji'),
        h('fieldset', { class: 'radio-group field', 'aria-describedby': 'fd-lic-pomoc' },
          h('legend', null, 'Licencja danych'),
          h('p', { class: 'hint', id: 'fd-lic-pomoc' }, 'Jak inni mogą korzystać z danych. Obie pasują do dane.gov.pl.'),
          lic.map(function (l) {
            const idl = 'fd-lic-' + l.kod;
            return h('div', { class: 'radio radio--opis' },
              h('input', { type: 'radio', name: 'fd-lic', id: idl, value: l.kod, checked: st.licencja === l.kod, 'aria-describedby': idl + '-opis',
                onchange: function () { st.licencja = l.kod; zaplanujZapis(); oglos('Wybrano licencję ' + (l.etykieta || l.kod) + '.'); } }),
              h('label', { for: idl }, l.etykieta || l.kod),
              h('p', { class: 'hint', id: idl + '-opis' }, OPIS_LIC[l.kod] || l.opis || ''));
          }))));
  }

  // ------------------------------------------------------------------ lista urządzeń
  function adresTekst(r) {
    return [r.ulica ? [r.cecha_ulicy, r.ulica].filter(Boolean).join(' ') + (r.numer_budynku ? ' ' + r.numer_budynku : '') : null,
      [r.kod_pocztowy, r.miejscowosc].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }
  function nazwaUrz(r, i) { return String(r.nazwa || 'Urządzenie ' + (i + 1) + ' (bez nazwy)'); }

  function odswiezListe(zFokusem) {
    const kont = $('fd-lista');
    if (!kont) return;
    kont.textContent = '';
    if (st.usuniete) {
      kont.appendChild(h('div', { class: 'alert alert--info', id: 'fd-cofnij' },
        h('p', null, 'Usunięto urządzenie „', nazwaUrz(st.usuniete.rekord, st.usuniete.indeks), '”. '),
        h('div', { class: 'alert-actions' }, h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'fd-cofnij-btn',
          onclick: function () {
            const u = st.usuniete; st.usuniete = null;
            st.urzadzenia.splice(Math.min(u.indeks, st.urzadzenia.length), 0, u.rekord);
            zaplanujZapis(); odswiezListe(); renderujKoniec();
            const nagl = $('fd-u-' + u.indeks + '-h'); if (nagl) nagl.focus();
            oglos('Przywrócono urządzenie ' + nazwaUrz(u.rekord, u.indeks) + '.');
          } }, 'Cofnij usunięcie'))));
    }
    if (!st.urzadzenia.length) {
      kont.appendChild(h('p', { class: 'empty' }, 'Nie dodano jeszcze żadnego urządzenia.'));
    } else {
      kont.appendChild(h('ul', { class: 'fd-urzadzenia' }, st.urzadzenia.map(function (r, i) {
        const nb = bledyUrzadzenia(r).length;
        const nazwa = nazwaUrz(r, i);
        const edytowane = st.edycja && st.edycja.indeks === i;
        return h('li', { class: 'fd-urzadzenie' + (edytowane ? ' is-edytowane' : '') },
          h('h3', { class: 'fd-urzadzenie__nazwa', id: 'fd-u-' + i + '-h', tabindex: '-1' }, (i + 1) + '. ' + nazwa),
          h('p', { class: 'meta' }, adresTekst(r) || 'Brak adresu',
            r.szerokosc_geograficzna !== null && r.szerokosc_geograficzna !== undefined && r.szerokosc_geograficzna !== ''
              ? ' · ' + r.szerokosc_geograficzna + ', ' + r.dlugosc_geograficzna : ' · brak współrzędnych'),
          h('p', { id: 'fd-u-' + i + '-stan' }, nb ? odznaka('err', liczba(nb) + ' ' + odmiana(nb, 'błąd', 'błędy', 'błędów') + ' do poprawy')
            : odznaka('ok', 'Kompletne'), edytowane ? [' ', odznaka('info', 'Edytujesz teraz')] : null),
          h('div', { class: 'cell-actions' },
            h('button', { type: 'button', class: 'btn btn--secondary btn--small', 'aria-describedby': 'fd-u-' + i + '-stan',
              onclick: function () { otworzEdytor(i); } }, 'Edytuj', h('span', { class: 'visually-hidden' }, ' – ' + nazwa)),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () { duplikuj(i); } },
              'Duplikuj', h('span', { class: 'visually-hidden' }, ' – ' + nazwa)),
            h('button', { type: 'button', class: 'btn btn--ghost btn--small', onclick: function () { usun(i); } },
              ikona('trash'), 'Usuń', h('span', { class: 'visually-hidden' }, ' – ' + nazwa))));
      })));
    }
    if (zFokusem === 'cofnij' && $('fd-cofnij-btn')) $('fd-cofnij-btn').focus();
  }

  function duplikuj(i) {
    if (!potwierdzPorzucenie()) return;
    const zr = st.urzadzenia[i];
    const nowy = Object.assign(kopia(zr), { id_aed: F().pusty(st.dysponent).id_aed, id_lokalne: null,
      nazwa: (zr.nazwa ? zr.nazwa + ' (kopia)' : null) });
    st.edycja = { indeks: null, wstawPo: i, rekord: nowy, dotkniete: new Set(), problemyWpisu: {}, proba: false };
    renderujEdytor(true);
    oglos('Utworzono kopię urządzenia ' + nazwaUrz(zr, i) + '. Zmień to, co się różni, i zapisz. Adres i współrzędne skopiowano.');
  }
  function usun(i) {
    const r = st.urzadzenia.splice(i, 1)[0];
    st.usuniete = { rekord: r, indeks: i };
    if (st.edycja && st.edycja.indeks === i) zamknijEdytor(false);
    else if (st.edycja && st.edycja.indeks > i) st.edycja.indeks--;
    zaplanujZapis(); odswiezListe('cofnij'); renderujKoniec();
    oglos('Usunięto urządzenie ' + nazwaUrz(r, i) + '. Możesz cofnąć usunięcie.');
  }
  function potwierdzPorzucenie() {
    if (!st.edycja || !st.edycja.dotkniete.size) return true;
    return window.confirm('Masz niezapisane zmiany w otwartym urządzeniu. Porzucić je?');
  }

  // ------------------------------------------------------------------ edytor urządzenia
  function etykietyPol() {
    const e = {};
    grupyUrzadzenia().forEach(function (g) { g.pola.forEach(function (p) { e[p.pole] = p.etykieta; }); });
    opisyDysponenta().forEach(function (p) { e[p.pole] = p.etykieta; });
    return e;
  }
  function polaEdytora() {
    const s = new Set();
    grupyUrzadzenia().forEach(function (g) { g.pola.forEach(function (p) { s.add(p.pole); }); });
    return s;
  }
  function problemyEdytora(wszystkie) {
    const ed = st.edycja;
    const pola = polaEdytora();
    const lista = waliduj(ed.rekord).filter(function (p) { return pola.has(p.pole) && (wszystkie || ed.dotkniete.has(p.pole)); });
    Object.keys(ed.problemyWpisu).forEach(function (pole) {
      if (wszystkie || ed.dotkniete.has(pole)) {
        const bez = lista.filter(function (p) { return p.pole !== pole; });
        lista.length = 0; Array.prototype.push.apply(lista, bez);
        lista.push({ pole: pole, poziom: 'blad', komunikat: ed.problemyWpisu[pole] });
      }
    });
    return lista;
  }
  function pokazPoleEdytora(pole) {
    const lista = problemyEdytora(st.edycja.proba).filter(function (p) { return p.pole === pole; });
    pokazProblemy('fd-e-', pole, lista);
  }
  function pokazWszystkieEdytora() {
    polaEdytora().forEach(function (pole) { pokazPoleEdytora(pole); });
  }

  /** Zmiana wartości pola w edytorze (wyjście z pola, wybór z listy). */
  function zmianaPola(pole, tekst) {
    const ed = st.edycja;
    if (!ed) return;
    const n = normalizuj(pole, tekst);
    const bylo = ed.rekord[pole];
    ed.rekord[pole] = n.wartosc;
    if (n.problem) ed.problemyWpisu[pole] = n.problem; else delete ed.problemyWpisu[pole];
    const zmieniono = JSON.stringify(bylo === undefined ? null : bylo) !== JSON.stringify(n.wartosc);
    if (zmieniono || !pusta(tekst)) ed.dotkniete.add(pole);
    if (!n.problem && n.wartosc !== null && String(n.wartosc) !== String(tekst).trim()) ustawKontrolke('fd-e-', pole, n.wartosc);
    // „ul. Lwowska” – moduł formularza oddziela cechę ulicy
    if (n.cecha_ulicy && polaEdytora().has('cecha_ulicy')) ustawPole('cecha_ulicy', n.cecha_ulicy);
    if (WSP.indexOf(pole) >= 0 && zmieniono) {
      // współrzędne wpisane ręcznie – wcześniejsze automatyczne źródło przestaje być prawdziwe
      if (ed.rekord.zrodlo_wspolrzednych === 'geokodowanie_adresu' || ed.rekord.zrodlo_wspolrzednych === 'wskazanie_na_mapie') {
        ustawPole('zrodlo_wspolrzednych', null);
        ustawPole('lokalizacja_przyblizona', false);
        oglos('Zmieniono współrzędne ręcznie. Źródło współrzędnych: nieznane (wpisane ręcznie).');
      }
      przesunZnacznik(false);
      opiszZrodloWsp();
    }
    pokazPoleEdytora(pole);
    // pola zależne (np. godziny przy dostępności) – odśwież, jeśli były już oglądane
    ed.dotkniete.forEach(function (p) { if (p !== pole) pokazPoleEdytora(p); });
    if (ed.proba) odswiezPodsumowanieEdytora(false);
    zaplanujZapis();
  }
  /** Programowe ustawienie wartości pola edytora (geokoder, mapa). */
  function ustawPole(pole, v) {
    const ed = st.edycja;
    if (!ed) return;
    ed.rekord[pole] = v === undefined ? null : v;
    delete ed.problemyWpisu[pole];
    ed.dotkniete.add(pole);
    ustawKontrolke('fd-e-', pole, ed.rekord[pole]);
    pokazPoleEdytora(pole);
  }

  /** Po zmianie rekordu funkcją modułu (zGeokodera, ustawPunkt) – odśwież kontrolki pól, które się zmieniły. */
  function synchronizuj(przed) {
    const ed = st.edycja;
    const zmienione = [];
    Object.keys(ed.rekord).forEach(function (k) {
      if (JSON.stringify(przed[k] === undefined ? null : przed[k]) === JSON.stringify(ed.rekord[k] === undefined ? null : ed.rekord[k])) return;
      zmienione.push(k);
      delete ed.problemyWpisu[k];
      ed.dotkniete.add(k);
      ustawKontrolke('fd-e-', k, ed.rekord[k]);
      pokazPoleEdytora(k);
    });
    return zmienione;
  }
  const OPIS_ZRODLA_WSP = { wskazanie_na_mapie: 'wskazanie na mapie', geokodowanie_adresu: 'wyszukanie adresu (punkt adresowy budynku)',
    pomiar_gps: 'pomiar GPS', nieznane: 'nieznane' };
  /** Tekst „Źródło współrzędnych: …” (pole techniczne – nie edytuje się go ręcznie, ale użytkownik widzi, co zapiszemy). */
  function opiszZrodloWsp() {
    const el = $('fd-wsp-zrodlo');
    const r = st.edycja && st.edycja.rekord;
    if (!el || !r) return;
    el.textContent = !biezaceWsp() ? 'Urządzenie nie ma jeszcze współrzędnych.'
      : 'Źródło współrzędnych: ' + (OPIS_ZRODLA_WSP[r.zrodlo_wspolrzednych] || 'nieznane (wpisane ręcznie)') +
        (r.lokalizacja_przyblizona ? '. Położenie przybliżone – przesuń znacznik w miejsce urządzenia, jeśli możesz.' : '.');
  }

  function otworzEdytor(indeks) {
    if (st.edycja && st.edycja.indeks === indeks && indeks !== null) { fokusEdytora(); return; }
    if (!potwierdzPorzucenie()) return;
    if (indeks === null) {
      st.edycja = { indeks: null, rekord: F().pusty(kopia(st.dysponent)), dotkniete: new Set(), problemyWpisu: {}, proba: false };
      DYSP.forEach(function (k) { delete st.edycja.rekord[k]; });
    } else {
      st.edycja = { indeks: indeks, rekord: kopia(st.urzadzenia[indeks]), dotkniete: new Set(), problemyWpisu: {}, proba: false };
    }
    renderujEdytor(true);
    odswiezListe();
    zaplanujZapis();
  }
  function fokusEdytora() { const n = $('h-fd-edytor'); if (n) { n.focus(); n.scrollIntoView({ block: 'start' }); } }

  function zamknijEdytor(zFokusem, idFokusu) {
    if (geoKontroler) geoKontroler.abort();
    if (odwrKontroler) odwrKontroler.abort();
    if (mapaEd) { mapaEd.zniszcz(); mapaEd = null; znacznik = null; }
    st.edycja = null;
    const kont = $('fd-edytor-kont');
    if (kont) kont.textContent = '';
    const dodaj = $('fd-dodaj'); if (dodaj) dodaj.hidden = false;
    zaplanujZapis();
    if (zFokusem) { const el = $(idFokusu || 'fd-dodaj'); if (el) el.focus(); }
  }

  function zapiszUrzadzenie() {
    const ed = st.edycja;
    ed.proba = true;
    // pola tekstowe mogły nie stracić fokusu (Enter w polu) – odczytujemy wszystkie bieżące wartości
    document.querySelectorAll('#fd-edytor input[type=text], #fd-edytor input[type=tel], #fd-edytor input[type=email], #fd-edytor textarea').forEach(function (el) {
      const pole = el.id.replace(/^fd-e-/, '');
      if (!polaEdytora().has(pole)) return;
      const n = normalizuj(pole, el.value);
      ed.rekord[pole] = n.wartosc;
      if (n.problem) ed.problemyWpisu[pole] = n.problem; else delete ed.problemyWpisu[pole];
    });
    pokazWszystkieEdytora();
    const b = bledy(problemyEdytora(true));
    if (b.length) {
      odswiezPodsumowanieEdytora(true);
      oglos('Nie zapisano. Popraw ' + liczba(b.length) + ' ' + odmiana(b.length, 'błąd', 'błędy', 'błędów') + '.', true);
      return;
    }
    const r = ed.rekord;
    r.data_aktualizacji_rekordu = teraz();
    let indeks;
    if (ed.indeks === null) {
      indeks = typeof ed.wstawPo === 'number' ? ed.wstawPo + 1 : st.urzadzenia.length;
      st.urzadzenia.splice(indeks, 0, r);
    } else { indeks = ed.indeks; st.urzadzenia[indeks] = r; }
    st.usuniete = null;
    const nowe = ed.indeks === null;
    zamknijEdytor(false);
    odswiezListe(); renderujKoniec();
    const nagl = $('fd-u-' + indeks + '-h'); if (nagl) nagl.focus();
    const ostrz = waliduj(r).filter(function (p) { return p.poziom === 'ostrzezenie'; }).length;
    oglos((nowe ? 'Dodano urządzenie ' : 'Zapisano zmiany w urządzeniu ') + nazwaUrz(r, indeks) + '.' +
      (ostrz ? ' Są ' + ostrz + ' ' + odmiana(ostrz, 'uwaga', 'uwagi', 'uwag') + ' do sprawdzenia.' : '') +
      ' Na liście jest ' + liczba(st.urzadzenia.length) + ' ' + odmiana(st.urzadzenia.length, 'urządzenie', 'urządzenia', 'urządzeń') + '.');
  }
  function odswiezPodsumowanieEdytora(zFokusem) {
    const b = bledy(problemyEdytora(true));
    podsumowanieBledow('fd-e-podsumowanie', 'fd-e-bledy', 'Popraw ' + liczba(b.length) + ' ' + odmiana(b.length, 'błąd', 'błędy', 'błędów') +
      ', aby zapisać urządzenie', b, 'fd-e-', etykietyPol());
    if (zFokusem && $('fd-e-bledy')) $('fd-e-bledy').focus();
  }

  // ---- lokalizacja: wyszukanie adresu, mapa, współrzędne
  function liczbaWsp(v) { const x = typeof v === 'number' ? v : Number(String(v === null || v === undefined ? '' : v).replace(',', '.')); return isFinite(x) && v !== '' && v !== null ? x : NaN; }
  function biezaceWsp() {
    const r = st.edycja && st.edycja.rekord;
    if (!r) return null;
    const a = liczbaWsp(r.szerokosc_geograficzna), b = liczbaWsp(r.dlugosc_geograficzna);
    return isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null;
  }
  function przesunZnacznik(wysrodkuj) {
    if (!mapaEd || !mapaEd.mapa) return;
    const w = biezaceWsp();
    if (!w) { if (znacznik) { mapaEd.mapa.removeLayer(znacznik); znacznik = null; } return; }
    if (!znacznik) {
      znacznik = L.marker(w, { draggable: true, keyboard: true, title: 'Położenie urządzenia', alt: 'Położenie urządzenia',
        icon: L.divIcon({ className: 'mapa-aed', html: '<span>AED</span>', iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(mapaEd.mapa);
      znacznik.on('dragend', function () { const ll = znacznik.getLatLng(); wskazNaMapie(ll.lat, ll.lng, 'przesunięto znacznik'); });
    } else znacznik.setLatLng(w);
    if (wysrodkuj !== false) mapaEd.mapa.setView(w, Math.max(mapaEd.mapa.getZoom(), 17));
  }
  function zaokr(x) { return Math.round(x * 1e6) / 1e6; }

  /** Punkt wskazany na mapie: współrzędne + źródło „wskazanie_na_mapie”; brakujący adres uzupełnia geokoder odwrotny. */
  function wskazNaMapie(lat, lon, jak) {
    if (!st.edycja) return;
    if (F().ustawPunkt) {
      const przed = Object.assign({}, st.edycja.rekord);
      F().ustawPunkt(st.edycja.rekord, lat, lon, 'mapa');
      synchronizuj(przed);
    } else {
      ustawPole('szerokosc_geograficzna', zaokr(lat));
      ustawPole('dlugosc_geograficzna', zaokr(lon));
      ustawPole('zrodlo_wspolrzednych', 'wskazanie_na_mapie');
      ustawPole('lokalizacja_przyblizona', false);
    }
    przesunZnacznik(false);
    opiszZrodloWsp();
    zaplanujZapis();
    oglos('Ustawiono położenie (' + jak + '): ' + zaokr(lat) + ', ' + zaokr(lon) + '. Źródło współrzędnych: wskazanie na mapie.');
    zaplanujOdwrotne(lat, lon);
  }

  /** Komunikat w obszarze wyszukiwania adresu (fd-geo-stan). rodzaj: ok | warn | err | info. */
  function komunikatGeo(rodzaj, tresc, akcje) {
    const s = $('fd-geo-stan');
    if (!s) return;
    s.hidden = false; s.className = 'alert alert--' + rodzaj + ' alert--small'; s.textContent = '';
    s.removeAttribute('tabindex');
    if (rodzaj === 'err') s.setAttribute('role', 'alert'); else s.removeAttribute('role');
    s.append(ikona(rodzaj === 'ok' ? 'ok' : rodzaj === 'info' ? 'info' : rodzaj), ' ', tresc);
    if (akcje) s.appendChild(h('span', { class: 'alert-actions' }, akcje));
  }

  let timerOdwrotne = null;
  /** Geokodowanie odwrotne po wskazaniu punktu – z opóźnieniem (kolejne przesunięcia w ciągu 1,2 s dają jedno zapytanie). */
  function zaplanujOdwrotne(lat, lon) {
    clearTimeout(timerOdwrotne);
    if (!G() || !G().odwrotne) return;
    timerOdwrotne = setTimeout(function () { odwrotne(lat, lon); }, OPOZNIENIE_ODWROTNE);
  }
  function odwrotne(lat, lon) {
    if (!st.edycja) return;
    if (odwrKontroler) odwrKontroler.abort();
    odwrKontroler = new AbortController();
    const sygnal = odwrKontroler.signal;
    const edycja = st.edycja;
    G().odwrotne(lat, lon, { signal: sygnal }).then(function (wynik) {
      const x = Array.isArray(wynik) ? wynik[0] : wynik;
      if (sygnal.aborted || st.edycja !== edycja) return;
      if (!x) { komunikatGeo('warn', 'Pod wskazanym punktem nie znaleziono adresu ani gminy. Sprawdź, czy punkt jest w Polsce.'); return; }
      const r = st.edycja.rekord;
      if (x.ostrzezenie) komunikatGeo('warn', 'Część danych o adresie jest niedostępna: ' + String(x.ostrzezenie));
      // puste pola adresu uzupełniamy od razu
      const pusteAdresu = pusta(r.miejscowosc);
      if (pusteAdresu) {
        uzupelnijAdres(x, true);
        if (!x.ostrzezenie) komunikatGeo('info', 'Uzupełniono puste pola adresu na podstawie najbliższego adresu: ' + String(x.opis || '') + '. Sprawdź je.');
        oglos('Uzupełniono puste pola adresu na podstawie najbliższego adresu: ' + String(x.opis || '') + '.');
        return;
      }
      const innaMiejscowosc = x.miejscowosc && String(x.miejscowosc).toLocaleLowerCase('pl') !== String(r.miejscowosc).toLocaleLowerCase('pl');
      const innyTerc = x.kod_terc_gminy && r.kod_terc_gminy && x.kod_terc_gminy !== r.kod_terc_gminy;
      if (innaMiejscowosc || innyTerc) {
        komunikatGeo('warn', 'Adres w formularzu nie pasuje do punktu (najbliższy adres: ' + String(x.opis || x.gmina || '') + '). Uzupełnić adres?',
          h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'fd-geo-uzupelnij', onclick: function () {
            if (!st.edycja) return;
            const zm = uzupelnijAdres(x, false);
            komunikatGeo('ok', 'Uzupełniono adres na podstawie punktu: ' + String(x.opis || '') + '.');
            const s = $('fd-geo-stan'); s.setAttribute('tabindex', '-1'); s.focus();
            oglos('Uzupełniono adres: ' + zm.length + ' ' + odmiana(zm.length, 'pole', 'pola', 'pól') + '.');
          } }, 'Uzupełnij adres z punktu'));
        oglos('Adres w formularzu nie pasuje do wskazanego punktu. Możesz uzupełnić adres przyciskiem pod polem wyszukiwania.');
      } else if (x.kod_terc_gminy && pusta(r.kod_terc_gminy)) {
        uzupelnijAdres(x, true); // np. kod TERC i województwo – pola techniczne
      }
    }).catch(function (e) {
      if (e && (e.kod === 'PRZERWANO' || e.name === 'AbortError')) return;
      console.warn('[AED] geokoder odwrotny:', e);
      komunikatGeo('warn', 'Nie udało się sprawdzić adresu dla wskazanego punktu: ' + String((e && e.message) || '') + ' Współrzędne zostały zapisane.');
    });
  }

  /** Pola adresu z wyniku geokodera. tylkoPuste: nie nadpisuje wpisanych wartości. Zwraca listę ustawionych pól. */
  function uzupelnijAdres(x, tylkoPuste) {
    if (F().zGeokodera) {
      const przed = Object.assign({}, st.edycja.rekord);
      F().zGeokodera(st.edycja.rekord, x, { nadpisz: !tylkoPuste, punkt: false });
      zaplanujZapis();
      return synchronizuj(przed);
    }
    const mapa = { miejscowosc: x.miejscowosc, cecha_ulicy: x.cecha_ulicy, ulica: x.ulica, numer_budynku: x.numer || x.numer_budynku,
      kod_pocztowy: x.kod_pocztowy, kod_terc_gminy: x.kod_terc_gminy, wojewodztwo: x.wojewodztwo };
    const pola = polaEdytora();
    const ustawione = [];
    Object.keys(mapa).forEach(function (k) {
      if (pusta(mapa[k]) || !pola.has(k)) return;
      if (tylkoPuste && !pusta(st.edycja.rekord[k])) return;
      ustawPole(k, normalizuj(k, String(mapa[k])).wartosc);
      ustawione.push(k);
    });
    // ulica bez cechy w danych geokodera – zostawiamy cechę „ul.”, gdy pole cechy jest puste
    if (ustawione.indexOf('ulica') >= 0 && pola.has('cecha_ulicy') && pusta(st.edycja.rekord.cecha_ulicy)) ustawPole('cecha_ulicy', 'ul.');
    zaplanujZapis();
    return ustawione;
  }

  function wybierzAdres(x, i) {
    if (F().ustawPunkt) {
      const przed = Object.assign({}, st.edycja.rekord);
      F().ustawPunkt(st.edycja.rekord, Number(x.lat), Number(x.lon), 'adres');
      synchronizuj(przed);
    } else {
      ustawPole('szerokosc_geograficzna', zaokr(Number(x.lat)));
      ustawPole('dlugosc_geograficzna', zaokr(Number(x.lon)));
      ustawPole('zrodlo_wspolrzednych', 'geokodowanie_adresu');
      ustawPole('lokalizacja_przyblizona', true);
    }
    uzupelnijAdres(x, false);
    przesunZnacznik(true);
    opiszZrodloWsp();
    const dokladny = !x.dokladnosc || x.dokladnosc === 'adres';
    const s = $('fd-geo-stan');
    s.hidden = false; s.className = 'alert alert--ok alert--small'; s.textContent = '';
    s.append(ikona('ok'), ' Wybrano: ' + String(x.opis || '') + '. ',
      dokladny ? 'Wpisaliśmy adres i współrzędne punktu adresowego budynku. Jeśli możesz, przesuń znacznik na mapie dokładnie w miejsce urządzenia.'
        : 'To przybliżone położenie (' + (x.dokladnosc === 'ulica' ? 'ulica' : 'miejscowość') + ', nie budynek). Wskaż dokładny punkt na mapie albo wpisz współrzędne.');
    s.setAttribute('tabindex', '-1');
    s.focus();
    oglos('Wybrano adres ' + String(x.opis || '') + '. Uzupełniono pola adresu i współrzędne.');
    if (!x.kod_terc_gminy && G() && G().gmina && isFinite(Number(x.lat))) {
      if (odwrKontroler) odwrKontroler.abort();
      odwrKontroler = new AbortController();
      const sygnal = odwrKontroler.signal, edycja = st.edycja;
      G().gmina(Number(x.lat), Number(x.lon), { signal: sygnal }).then(function (g) {
        if (sygnal.aborted || st.edycja !== edycja || !g) return;
        if (g.kod_terc_gminy) ustawPole('kod_terc_gminy', g.kod_terc_gminy);
        if (g.wojewodztwo) ustawPole('wojewodztwo', g.wojewodztwo);
        zaplanujZapis();
      }).catch(function (e) { if (!(e && (e.kod === 'PRZERWANO' || e.name === 'AbortError'))) console.warn('[AED] gmina dla punktu:', e); });
    }
    document.querySelectorAll('#fd-geo-wyniki button').forEach(function (b, j) { b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
  }

  async function szukajAdresu() {
    const pole = $('fd-geo-adres');
    const tekst = pole.value.trim();
    const stan = $('fd-geo-stan'), wyniki = $('fd-geo-wyniki');
    wyniki.textContent = '';
    stan.removeAttribute('tabindex');
    if (!G() || !G().szukaj) {
      stan.hidden = false; stan.className = 'alert alert--err alert--small';
      stan.textContent = 'Wyszukiwanie adresów jest niedostępne. Wskaż punkt na mapie albo wpisz współrzędne ręcznie.';
      return;
    }
    if (!tekst) {
      stan.hidden = false; stan.className = 'field-error'; stan.textContent = '';
      stan.append(ikona('err'), ' Wpisz adres, np. Krosno, Lwowska 28A.');
      pole.setAttribute('aria-invalid', 'true'); pole.focus();
      oglos('Wpisz adres do wyszukania.', true);
      return;
    }
    pole.removeAttribute('aria-invalid');
    if (geoKontroler) geoKontroler.abort();
    geoKontroler = new AbortController();
    const sygnal = geoKontroler.signal;
    const btn = $('fd-geo-szukaj'), anuluj = $('fd-geo-anuluj');
    btn.setAttribute('aria-disabled', 'true'); btn.classList.add('is-busy'); anuluj.hidden = false;
    stan.hidden = false; stan.className = 'remote-status'; stan.textContent = 'Szukanie adresu…';
    let lista;
    try {
      lista = await G().szukaj(tekst, { signal: sygnal });
      if (sygnal.aborted) throw Object.assign(new Error('Przerwano.'), { kod: 'PRZERWANO' });
    } catch (e) {
      koniecSzukania();
      if (e && (e.kod === 'PRZERWANO' || e.name === 'AbortError')) { stan.hidden = true; oglos('Anulowano wyszukiwanie adresu.'); return; }
      console.warn('[AED] obsłużony błąd geokodera:', e);
      const kod = e && e.kod;
      const rada = kod === 'SIEC' ? 'Sprawdź połączenie z internetem albo wskaż punkt na mapie lub wpisz współrzędne ręcznie.'
        : kod === 'FORMAT' ? 'Zapisz adres inaczej (np. „Krosno, Lwowska 28”) albo wskaż punkt na mapie.' : '';
      stan.hidden = false; stan.className = 'alert alert--err alert--small'; stan.textContent = '';
      stan.setAttribute('role', 'alert');
      stan.append(h('strong', null, 'Nie udało się wyszukać adresu. '), String((e && e.message) || ''), ' ', rada);
      return;
    }
    koniecSzukania();
    stan.removeAttribute('role');
    if (!lista || !lista.length) {
      stan.hidden = false; stan.className = 'alert alert--warn alert--small';
      stan.textContent = 'Nie znaleziono adresu „' + tekst + '”. Sprawdź pisownię, dodaj miejscowość albo wskaż punkt na mapie.';
      oglos(stan.textContent);
      return;
    }
    stan.hidden = false; stan.className = 'meta';
    stan.textContent = 'Znaleziono ' + lista.length + ' ' + odmiana(lista.length, 'adres', 'adresy', 'adresów') + '. Wybierz właściwy:';
    // Wynik przybliżony (np. wieś bez ulic, numer nieznaleziony) – pokaż wskazówkę z geokodera
    const przyblizony = lista.find(function (x) { return x && x.przyblizony && x.wskazowka; });
    if (przyblizony) {
      stan.className = 'alert alert--warn alert--small';
      stan.textContent = przyblizony.wskazowka + ' Propozycje (' + lista.length + '):';
    }
    wyniki.appendChild(h('ul', { class: 'fd-geo-lista', 'aria-labelledby': 'fd-geo-stan' }, lista.slice(0, 10).map(function (x, i) {
      return h('li', null, h('button', { type: 'button', class: 'btn btn--secondary btn--small', 'aria-pressed': 'false',
        onclick: function () { wybierzAdres(x, i); } }, 'Wybierz: ', String(x.opis || [x.ulica, x.numer, x.miejscowosc].filter(Boolean).join(' '))));
    })));
    const pierwszy = wyniki.querySelector('button'); if (pierwszy) pierwszy.focus();
    oglos(stan.textContent + ' Lista propozycji jest pod polem wyszukiwania.');
  }
  function koniecSzukania() {
    const btn = $('fd-geo-szukaj'), anuluj = $('fd-geo-anuluj');
    if (!btn) return;
    const fokusNaAnuluj = document.activeElement === anuluj;
    btn.removeAttribute('aria-disabled'); btn.classList.remove('is-busy'); anuluj.hidden = true;
    if (fokusNaAnuluj) btn.focus();
    geoKontroler = null;
  }

  function blokLokalizacji() {
    const blok = h('div', { class: 'fd-lokalizacja' },
      h('h4', null, 'Znajdź adres'),
      h('div', { class: 'field' },
        h('label', { for: 'fd-geo-adres' }, 'Adres urządzenia'),
        h('p', { class: 'hint', id: 'fd-geo-pomoc' }, 'Np. Krosno, Lwowska 28A. Po wybraniu adresu wpiszemy pola adresu i współrzędne.'),
        h('div', { class: 'input-row' },
          h('input', { type: 'search', id: 'fd-geo-adres', autocomplete: 'off', 'aria-describedby': 'fd-geo-pomoc',
            onkeydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); if ($('fd-geo-szukaj').getAttribute('aria-disabled') !== 'true') szukajAdresu(); } },
            oninput: function (e) { e.target.removeAttribute('aria-invalid'); } }),
          h('button', { type: 'button', class: 'btn btn--secondary', id: 'fd-geo-szukaj',
            onclick: function (e) { if (e.currentTarget.getAttribute('aria-disabled') !== 'true') szukajAdresu(); } }, 'Szukaj adresu'),
          h('button', { type: 'button', class: 'btn btn--ghost', id: 'fd-geo-anuluj', hidden: true,
            onclick: function () { if (geoKontroler) geoKontroler.abort(); } }, 'Anuluj'))),
      h('p', { id: 'fd-geo-stan', hidden: true }),
      h('div', { id: 'fd-geo-wyniki' }),
      h('p', { class: 'meta', id: 'fd-wsp-zrodlo' }));
    if (AED.ui.mapa) {
      blok.appendChild(h('h4', null, 'Wskaż miejsce na mapie'));
      blok.appendChild(h('p', { class: 'hint' }, 'Kliknij mapę albo przeciągnij znacznik AED w miejsce, gdzie wisi urządzenie. ',
        'Bez myszy: przesuń mapę strzałkami tak, aby urządzenie było w środku, i naciśnij „Ustaw punkt w środku mapy”. ',
        'Zawsze możesz też wpisać współrzędne w polach poniżej.'));
      mapaEd = AED.ui.mapa.utworz({ etykieta: 'Mapa – położenie urządzenia', klasa: 'mapa__okno--celownik' });
      blok.appendChild(mapaEd.element);
      blok.appendChild(h('div', { class: 'cell-actions' },
        h('button', { type: 'button', class: 'btn btn--secondary btn--small', id: 'fd-mapa-srodek', disabled: !mapaEd.mapa || null,
          onclick: function () { const c = mapaEd.mapa.getCenter(); wskazNaMapie(c.lat, c.lng, 'środek mapy'); } }, 'Ustaw punkt w środku mapy'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', disabled: !mapaEd.mapa || null,
          onclick: function () { if (biezaceWsp()) { przesunZnacznik(true); oglos('Mapa pokazuje położenie urządzenia.'); } else oglos('Urządzenie nie ma jeszcze współrzędnych.'); } },
          'Pokaż urządzenie na mapie')));
      if (mapaEd.mapa) {
        mapaEd.mapa.on('click', function (e) { wskazNaMapie(e.latlng.lat, e.latlng.lng, 'kliknięcie mapy'); });
        setTimeout(function () {
          if (!mapaEd) return;
          mapaEd.odswiez();
          if (biezaceWsp()) przesunZnacznik(true);
        }, 0);
      }
    }
    return blok;
  }

  function renderujEdytor(zFokusem) {
    const kont = $('fd-edytor-kont');
    if (!kont) return;
    if (mapaEd) { mapaEd.zniszcz(); mapaEd = null; znacznik = null; }
    kont.textContent = '';
    const ed = st.edycja;
    if (!ed) { $('fd-dodaj').hidden = false; return; }
    $('fd-dodaj').hidden = true;
    const r = ed.rekord;
    const tytul = ed.indeks === null ? 'Nowe urządzenie' : 'Edycja urządzenia ' + (ed.indeks + 1) + ': ' + nazwaUrz(r, ed.indeks);
    const formularz = h('form', { id: 'fd-edytor', class: 'fd-form fd-edytor', novalidate: true, 'aria-labelledby': 'h-fd-edytor',
      onsubmit: function (e) { e.preventDefault(); zapiszUrzadzenie(); } },
      h('h3', { id: 'h-fd-edytor', tabindex: '-1' }, tytul),
      h('p', { class: 'hint' }, 'Gwiazdka (*) = pole obowiązkowe. Pozostałe pola są schowane pod „Więcej” – wypełnij, jeśli znasz odpowiedź.'),
      h('p', { class: 'meta' }, 'Numer urządzenia (nadawany automatycznie): ', h('code', null, String(r.id_aed || '—'))),
      h('div', { id: 'fd-e-podsumowanie' }),
      grupyUrzadzenia().map(function (g) {
        const lok = g.pola.some(function (p) { return WSP.indexOf(p.pole) >= 0; });
        return h('fieldset', { class: 'fd-grupa', 'aria-describedby': g.opis ? 'fd-g-' + g.id + '-opis' : null },
          h('legend', null, g.nazwa),
          g.opis ? h('p', { class: 'hint', id: 'fd-g-' + g.id + '-opis' }, g.opis) : null,
          lok ? blokLokalizacji() : null,
          lok ? h('h4', null, 'Współrzędne i adres') : null,
          h('div', { class: 'fd-pola' }, polaZWiecej(g.pola, r, function (p) {
            return kontrolka(p, { prefiks: 'fd-e-', wartosc: r[p.pole], onZmiana: zmianaPola });
          }, 'fd-e-wiecej-' + g.id, 'Więcej')));
      }),
      h('div', { class: 'step-actions fd-edytor__akcje' },
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () {
          if (!potwierdzPorzucenie()) return;
          const idx = ed.indeks;
          zamknijEdytor(true, idx !== null ? 'fd-u-' + idx + '-h' : 'fd-dodaj');
          odswiezListe();
          if (idx !== null) { const n = $('fd-u-' + idx + '-h'); if (n) n.focus(); }
          oglos('Zamknięto formularz urządzenia bez zapisywania zmian.');
        } }, 'Anuluj'),
        h('button', { type: 'submit', class: 'btn btn--primary' }, ed.indeks === null ? 'Dodaj urządzenie do listy' : 'Zapisz zmiany')));
    kont.appendChild(formularz);
    opiszZrodloWsp();
    if (ed.proba) { pokazWszystkieEdytora(); odswiezPodsumowanieEdytora(false); }
    else ed.dotkniete.forEach(pokazPoleEdytora);
    if (zFokusem) fokusEdytora();
  }

  // ------------------------------------------------------------------ zakończenie: CSV albo scalanie
  /** Lokalne „teraz” w formacie wzorca (RRRR-MM-DDThh:mm:ss, bez strefy). */
  function teraz() {
    const N = AED.normalizacja;
    if (N && N.dataCzas) return N.dataCzas(new Date());
    const d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  }
  function rekordyDoWydania() {
    const t = teraz();
    return st.urzadzenia.map(function (r) {
      const x = pelny(r);
      x.data_aktualizacji_rekordu = x.data_aktualizacji_rekordu || t;
      return x;
    });
  }
  /** Problemy blokujące wydanie danych: brak urządzeń, błędy dysponenta, błędy urządzeń, otwarty edytor. */
  function przeszkody() {
    const lista = [];
    if (st.edycja && st.edycja.dotkniete.size) lista.push({ tekst: 'Zapisz albo anuluj zmiany w otwartym urządzeniu.', cel: 'h-fd-edytor' });
    const bd = bledy(problemyDysponenta().concat(Object.keys(dyspProblemyWpisu).map(function (p) { return { pole: p, poziom: 'blad' }; })));
    if (bd.length) lista.push({ tekst: 'Uzupełnij dane dysponenta (' + liczba(bd.length) + ' ' + odmiana(bd.length, 'błąd', 'błędy', 'błędów') + ').', cel: 'h-fd-dysp', dysp: true });
    if (!st.urzadzenia.length) lista.push({ tekst: 'Dodaj co najmniej jedno urządzenie.', cel: 'fd-dodaj' });
    st.urzadzenia.forEach(function (r, i) {
      const n = bledyUrzadzenia(r).length;
      if (n) lista.push({ tekst: 'Urządzenie ' + (i + 1) + ' („' + nazwaUrz(r, i) + '”): ' + liczba(n) + ' ' + odmiana(n, 'błąd', 'błędy', 'błędów') + '.', cel: 'fd-u-' + i + '-h' });
    });
    return lista;
  }
  function pokazPrzeszkody(lista) {
    const kont = $('fd-koniec-stan');
    kont.textContent = '';
    if (lista.some(function (x) { return x.dysp; })) {
      opisyDysponenta().forEach(function (p) { dyspDotkniete.add(p.pole); pokazDysponenta(p.pole); });
      const pd = bledy(problemyDysponenta()).concat(Object.keys(dyspProblemyWpisu).map(function (p) { return { pole: p, poziom: 'blad', komunikat: dyspProblemyWpisu[p] }; }));
      const et = {}; opisyDysponenta().forEach(function (p) { et[p.pole] = p.etykieta; });
      podsumowanieBledow('fd-d-podsumowanie', 'fd-d-bledy', 'Popraw dane dysponenta', pd, 'fd-d-', et);
    }
    kont.appendChild(h('div', { class: 'alert alert--err' },
      h('h3', { id: 'fd-koniec-bledy', tabindex: '-1' }, 'Zanim przekażesz dane'),
      h('ul', null, lista.map(function (x) {
        return h('li', null, h('a', { href: '#' + x.cel, onclick: function (e) {
          e.preventDefault();
          const el = $(x.cel); if (el) { if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1'); el.focus(); el.scrollIntoView({ block: 'start' }); }
        } }, x.tekst));
      }))));
    $('fd-koniec-bledy').focus();
    oglos('Nie można jeszcze przekazać danych. ' + lista.map(function (x) { return x.tekst; }).join(' '), true);
  }
  function dodajDoScalania() {
    const p = przeszkody();
    if (p.length) { pokazPrzeszkody(p); return; }
    const kont = $('fd-koniec-stan'); kont.textContent = '';
    if (st.dodane && store.zrodlo(st.dodane.id)) {
      kont.appendChild(h('div', { class: 'alert alert--warn' },
        h('p', null, 'Te urządzenia są już w rejestrze źródeł jako ', h('strong', null, st.dodane.kod),
          '. Aby dodać je ponownie (np. po zmianach), najpierw usuń to źródło w kroku 1.'),
        h('div', { class: 'alert-actions' }, h('a', { class: 'btn btn--secondary btn--small', href: '#zrodla' }, 'Przejdź do kroku 1'))));
      kont.querySelector('a').focus();
      return;
    }
    let z;
    try { z = F().dodajDoZbioru(rekordyDoWydania(), { dysponent: String(st.dysponent.dysponent_nazwa || ''), licencja: st.licencja }); } catch (e) {
      console.error(e);
      kont.appendChild(h('p', { class: 'alert alert--err', role: 'alert' }, 'Nie udało się dodać urządzeń do scalania: ' + (e && e.message ? e.message : e)));
      return;
    }
    try { if (store.przelicz) store.przelicz(); } catch (e) { console.error(e); } // rekordy źródła po mapowaniu 1:1
    st.dodane = z ? { id: z.id, kod: z.kod } : null;
    const n = st.urzadzenia.length;
    AED.router.idz('zrodla');
    setTimeout(function () {
      oglos('Dodano źródło ' + (z ? z.kod : '') + ' z formularza: ' + liczba(n) + ' ' + odmiana(n, 'urządzenie', 'urządzenia', 'urządzeń') +
        '. Źródło jest w rejestrze źródeł w kroku 1.');
    }, 100);
  }

  /** Postęp „1. Instytucja → 2. Urządzenia → 3. Przekaż dane” (tekst, nie tylko kolor). */
  function odswiezPostep() {
    const ol = $('fd-postep');
    if (!ol) return;
    const bledyD = bledy(problemyDysponenta());
    const dyspOk = !bledyD.length && !Object.keys(dyspProblemyWpisu).length && !pusta(st.dysponent.dysponent_nazwa);
    // „do poprawy” tylko dla pól już wpisanych; puste obowiązkowe = „do uzupełnienia”
    const bd = bledyD.filter(function (p) { return !pusta(st.dysponent[p.pole]); }).length + Object.keys(dyspProblemyWpisu).length;
    const n = st.urzadzenia.length;
    const zBledami = st.urzadzenia.filter(function (r) { return bledyUrzadzenia(r).length; }).length;
    const otwarte = !!(st.edycja && st.edycja.dotkniete.size);
    const urzOk = n > 0 && !zBledami && !otwarte;
    const kroki = [
      { cel: 'h-fd-dysp', nazwa: 'Instytucja', ok: dyspOk,
        stan: dyspOk ? 'Gotowe' : (bd ? 'Do poprawy: ' + liczba(bd) + ' ' + odmiana(bd, 'pole', 'pola', 'pól') : 'Do uzupełnienia') },
      { cel: 'h-fd-urz', nazwa: 'Urządzenia', ok: urzOk,
        stan: !n ? 'Brak urządzeń' : liczba(n) + ' ' + odmiana(n, 'urządzenie', 'urządzenia', 'urządzeń') +
          (zBledami ? ', ' + liczba(zBledami) + ' do poprawy' : (otwarte ? ', jedno otwarte' : ' – gotowe')) },
      { cel: 'h-fd-koniec', nazwa: 'Przekaż dane', ok: false, stan: dyspOk && urzOk ? 'Możesz pobrać plik' : 'Po krokach 1 i 2' }
    ];
    const biezacy = kroki.findIndex(function (k) { return !k.ok; });
    ol.textContent = '';
    kroki.forEach(function (k, i) {
      ol.appendChild(h('li', { class: (k.ok ? 'is-gotowe' : '') + (i === biezacy ? ' is-biezacy' : '') },
        h('span', { class: 'fd-postep__num', 'aria-hidden': 'true' }, k.ok ? '✓' : String(i + 1)),
        h('span', { class: 'fd-postep__tekst' },
          h('a', { href: '#' + k.cel, 'aria-current': i === biezacy ? 'step' : null, onclick: function (e) {
            e.preventDefault(); // #hash służy routerowi – przenosimy tylko fokus
            const el = $(k.cel); if (el) { el.focus(); el.scrollIntoView({ block: 'start' }); }
          } }, (i + 1) + '. ' + k.nazwa),
          h('span', { class: 'fd-postep__stan' }, k.stan))));
    });
  }

  function renderujKoniec() {
    odswiezPostep();
    const kont = $('fd-koniec');
    if (!kont) return;
    const n = st.urzadzenia.length;
    const stan = $('fd-koniec-stan'); if (stan) stan.textContent = '';
    const info = $('fd-koniec-liczba');
    if (info) info.textContent = n ? 'Na liście: ' + liczba(n) + ' ' + odmiana(n, 'urządzenie', 'urządzenia', 'urządzeń') + '.' : 'Lista urządzeń jest pusta.';
  }
  function sekcjaKonca() {
    return h('section', { class: 'fd-sekcja', id: 'fd-koniec', 'aria-labelledby': 'h-fd-koniec' },
      h('h2', { id: 'h-fd-koniec', tabindex: '-1' }, '3. Przekaż dane'),
      h('p', { id: 'fd-koniec-liczba' }),
      h('section', { class: 'gov-wysylka', id: 'fd-gov', 'aria-label': 'Wyślij do zatwierdzenia przez bazę gov.pl' },
        h('div', { class: 'gov-przycisk' },
          h('button', { type: 'button', class: 'btn btn--gov btn--big', id: 'fd-wyslij-gov', 'aria-describedby': 'fd-gov-opis', onclick: wyslijDoGov },
            'Wyślij do zatwierdzenia przez bazę gov.pl'),
          h('p', { class: 'hint', id: 'fd-gov-opis' }, 'Wyśle dane do bazy dane.gov.pl (symulacja – zapis w lokalnej bazie projektu).')),
        h('p', { class: 'remote-status gov-postep', id: 'fd-gov-postep', role: 'status', 'aria-live': 'polite' }),
        h('div', { id: 'fd-gov-wynik' })),
      h('div', { id: 'fd-koniec-stan' }),
      h('div', { class: 'cards' },
        h('article', { class: 'card' },
          h('h3', null, 'Dodaj do wspólnego zbioru'),
          h('p', null, 'Gdy scalasz dane z wielu źródeł w tej przeglądarce (np. jako koordynator), dodaj te urządzenia jako jedno źródło ',
            'w rejestrze źródeł. Przejdziesz do kroku 1 scalania.'),
          h('button', { type: 'button', class: 'btn btn--secondary', id: 'fd-do-scalania', onclick: dodajDoScalania }, 'Dodaj do scalania'))));
  }

  let wysylanieGov = false;
  async function wyslijDoGov() {
    if (wysylanieGov) return;
    const G = AED.gov, wynik = $('fd-gov-wynik'), postep = $('fd-gov-postep'), btn = $('fd-wyslij-gov');
    wynik.textContent = '';
    const p = przeszkody();
    if (p.length) { pokazPrzeszkody(p); return; }
    if (!G) { wynik.appendChild(h('p', { class: 'alert alert--err', role: 'alert' }, 'Nie wczytano modułu wysyłki (js/core/gov.js).')); return; }
    $('fd-koniec-stan').textContent = '';
    wysylanieGov = true; btn.setAttribute('aria-disabled', 'true'); btn.classList.add('is-busy');
    try {
      const zgl = G.zbierzZgloszenieFormularza(rekordyDoWydania(), { dysponent: String(st.dysponent.dysponent_nazwa || ''), licencja: st.licencja });
      const w = await G.wyslij(zgl, { onPostep: function (t) { postep.textContent = t; }, opoznienieMs: 1500 });
      postep.textContent = '';
      const pobrano = AED.ui.gov ? await AED.ui.gov.zapiszPlikBazy(zgl, w) : false;
      wynik.appendChild(h('div', { class: 'alert alert--ok gov-potwierdzenie', role: 'status' },
        h('h3', { id: 'fd-gov-tytul', tabindex: '-1' }, ikona('ok'), ' Dane zostały wysłane do bazy dane.gov.pl'),
        h('p', null, 'Dane zapisano w lokalnej bazie projektu' + (pobrano ? ' i pobrano plik wyniki_gov.txt z wysłanymi danymi.' : '.'))));
      $('fd-gov-tytul').focus();
      oglos('Dane zostały wysłane do bazy dane.gov.pl (symulacja).');
    } catch (e) {
      console.warn('[AED] wysyłka z formularza:', e);
      postep.textContent = '';
      wynik.appendChild(h('p', { class: 'alert alert--err', role: 'alert' }, 'Nie udało się wysłać zgłoszenia: ' + (e && e.message ? e.message : e)));
    } finally {
      wysylanieGov = false; btn.removeAttribute('aria-disabled'); btn.classList.remove('is-busy');
    }
  }

  // ------------------------------------------------------------------ całość
  function renderuj() {
    const kont = $('fd-tresc');
    if (!kont) return;
    kont.textContent = '';
    if (!F()) {
      kont.appendChild(h('p', { class: 'alert alert--err' }, 'Nie wczytano modułu formularza (AED.formularz). Możesz ',
        h('a', { href: 'wzorzec/szablon_aed.csv', download: true }, 'pobrać szablon CSV'), ' i wypełnić go w arkuszu.'));
      return;
    }
    kont.append(
      h('div', { class: 'note fd-szkic' },
        h('p', null, ikona('info'), ' Dane zapisują się automatycznie ', h('strong', null, 'tylko w tej przeglądarce'),
          '. Nie wysyłamy ich nigdzie. Możesz wrócić później.'),
        h('p', { class: 'meta', id: 'fd-szkic-stan' }, st.zapisanoSzkic ? 'Przywrócono zapisany szkic.' : ''),
        h('button', { type: 'button', class: 'btn btn--ghost btn--small', id: 'fd-wyczysc', onclick: wyczysc }, 'Wyczyść formularz i usuń szkic')),
      h('nav', { 'aria-labelledby': 'h-fd-postep' },
        h('h2', { id: 'h-fd-postep', class: 'visually-hidden' }, 'Postęp wypełniania'),
        h('ol', { class: 'fd-postep', id: 'fd-postep' })),
      sekcjaDysponenta(),
      h('section', { class: 'fd-sekcja', 'aria-labelledby': 'h-fd-urz' },
        h('h2', { id: 'h-fd-urz', tabindex: '-1' }, '2. Urządzenia AED'),
        h('p', null, 'Każde urządzenie osobno. Kilka AED w jednym budynku? Użyj „Duplikuj” i zmień piętro.'),
        h('div', { id: 'fd-lista' }),
        h('button', { type: 'button', class: 'btn btn--primary', id: 'fd-dodaj', onclick: function () { otworzEdytor(null); } }, '+ Dodaj urządzenie'),
        h('div', { id: 'fd-edytor-kont' })),
      sekcjaKonca());
    // błędy dysponenta przy polach już wypełnionych (np. po przywróceniu szkicu)
    opisyDysponenta().forEach(function (p) { if (!pusta(st.dysponent[p.pole])) { dyspDotkniete.add(p.pole); pokazDysponenta(p.pole); } });
    odswiezListe();
    renderujEdytor(false);
    renderujKoniec();
  }

  function wyczysc() {
    if (!window.confirm('Usunąć wszystkie wpisane dane (dysponenta i urządzenia) z tej przeglądarki? Tej operacji nie można cofnąć.')) return;
    if (mapaEd) { mapaEd.zniszcz(); mapaEd = null; znacznik = null; }
    st.dysponent = {}; st.licencja = 'CC0-1.0'; st.urzadzenia = []; st.edycja = null; st.usuniete = null; st.zapisanoSzkic = null;
    dyspDotkniete.clear(); Object.keys(dyspProblemyWpisu).forEach(function (k) { delete dyspProblemyWpisu[k]; });
    try { if (F().usunSzkic) F().usunSzkic(); else F().zapiszSzkic([]); } catch (e) { console.error(e); }
    renderuj();
    $('h-fd-dysp').focus();
    oglos('Wyczyszczono formularz i usunięto szkic z tej przeglądarki.');
  }

  function init() {
    AED.on('trasa', function (e) {
      if (e.trasa !== 'formularz') {
        if (st.zainicjowano) zapiszSzkic();
        return;
      }
      if (!st.zainicjowano) {
        st.zainicjowano = true;
        if (F() && wczytajSzkic()) st.zapisanoSzkic = new Date();
        renderuj();
        if (st.zapisanoSzkic) oglos('Przywrócono szkic formularza zapisany w tej przeglądarce.');
      } else if (mapaEd) setTimeout(function () { if (mapaEd) mapaEd.odswiez(); }, 0);
    });
    window.addEventListener('pagehide', function () { if (st.zainicjowano) zapiszSzkic(); });
  }

  AED.ui = AED.ui || {};
  AED.ui.formularz = { init: init, renderuj: renderuj, get stan() { return st; } };
})(window.AED);
