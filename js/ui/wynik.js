/* Krok 4: wynik scalania, licencja, metadane zbioru i pobieranie plików.
   Scalanie (decyzje z kroku 3) – AED.store.przeliczWynik / wynik; pliki i metadane – AED.eksport.
   Dane z rekordów są niezaufane – trafiają do DOM wyłącznie przez h() (textContent / atrybuty). */
(function (AED) {
  'use strict';
  const { h, odznaka, oglos, liczba, odmiana, tabelaPrzewijana, rozmiar, pobierz } = AED.dom;
  const store = AED.store;

  // Słowniki harvestera (otwarte_dane_latest.xsd) – zapas, gdy AED.eksport.SLOWNIKI_XML ich nie poda
  const CZESTOTLIWOSC = [
    { kod: 'daily', etykieta: 'Codziennie' }, { kod: 'weekly', etykieta: 'Co tydzień' }, { kod: 'monthly', etykieta: 'Co miesiąc' },
    { kod: 'quarterly', etykieta: 'Co kwartał' }, { kod: 'everyHalfYear', etykieta: 'Co pół roku' }, { kod: 'yearly', etykieta: 'Co rok' },
    { kod: 'irregular', etykieta: 'Nieregularnie' }, { kod: 'notPlanned', etykieta: 'Jednorazowe udostępnienie' }];
  const PLIKI = [
    { kod: 'csv', nazwa: 'CSV', opis: 'Zalecany format do publikacji w dane.gov.pl. Kodowanie UTF-8, nagłówki zgodne ze wzorcem.', typ: 'text/csv;charset=utf-8', zalecany: true },
    { kod: 'xlsx', nazwa: 'XLSX (Excel)', opis: 'Do przeglądania i poprawiania w arkuszu kalkulacyjnym.', typ: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { kod: 'json', nazwa: 'JSON', opis: 'Dla programistów i aplikacji.', typ: 'application/json;charset=utf-8' },
    { kod: 'geojson', nazwa: 'GeoJSON', opis: 'Punkty do map (np. QGIS, uMap). Zawiera tylko rekordy ze współrzędnymi.', typ: 'application/geo+json;charset=utf-8' },
    { kod: 'rejestr', nazwa: 'Rejestr źródeł (CSV)', opis: 'Skąd pochodzą dane: źródła, ich licencje i liczba rekordów. Dołącz go do zbioru.', typ: 'text/csv;charset=utf-8' },
    { kod: 'datapackage', nazwa: 'datapackage.json', opis: 'Opis zbioru i kolumn w standardzie Frictionless Data. Wymaga poprawnych metadanych.', typ: 'application/json;charset=utf-8', metadane: true },
    { kod: 'xml', nazwa: 'Metadane XML (harvester)', opis: 'Plik dla automatycznego pobierania przez dane.gov.pl. Wymaga poprawnych metadanych i adresu plików https://.', typ: 'application/xml;charset=utf-8', metadane: true }
  ];

  // opisy zasobów w metadanych (dla odbiorców danych, nie instrukcje dla urzędnika)
  const FORMAT = { csv: 'CSV', xlsx: 'XLSX', json: 'JSON', geojson: 'GeoJSON', rejestr: 'CSV' };
  const OPIS_ZASOBU = {
    csv: 'Lokalizacje defibrylatorów AED w formacie CSV (UTF-8, separator przecinek). Nagłówki to nazwy pól wzorcowego zakresu danych o AED.',
    xlsx: 'Lokalizacje defibrylatorów AED w formacie XLSX. Arkusze: dane, rejestr źródeł i pochodzenie rekordów scalonych.',
    json: 'Lokalizacje defibrylatorów AED w formacie JSON (tablica rekordów z polami wzorca).',
    geojson: 'Lokalizacje defibrylatorów AED jako punkty GeoJSON (WGS 84) – do map i systemów GIS.',
    rejestr: 'Rejestr źródeł danych: skąd pochodzą rekordy, licencje źródeł i liczba rekordów z każdego źródła.'
  };

  const st = {
    pominBledy: false,
    wynik: null,          // {rekordy, raport} ze store
    brudne: true,         // wynik do przeliczenia (zmiana decyzji, rekordów, opcji)
    bledne: new Set(),    // _id rekordów wynikowych z błędami
    eksport: [],          // rekordy do eksportu (po opcjach)
    metadane: null,
    edytowane: {},        // pola metadanych zmienione przez użytkownika
    problemy: [],
    sprawdzono: false,
    pobrane: {},          // kod -> {nazwa, rozmiar}
    bledyPobrania: {},
    kolorWg: 'status'     // kolor punktów na mapie: 'status' albo 'zrodlo'
  };
  const mapaWyn = { obiekt: null, warstwa: null, dopasowano: false };

  function $(id) { return document.getElementById(id); }
  function E() { return AED.eksport || null; }
  function tekst(x) { return typeof x === 'string' ? x : JSON.stringify(x, null, 2); }
  function slownik(nazwa, zapas) {
    const s = E() && E().SLOWNIKI_XML && E().SLOWNIKI_XML[nazwa];
    if (!s) return zapas;
    // słownik może być tablicą {kod, etykieta} albo obiektem kod -> etykieta
    if (Array.isArray(s)) return s.map(function (x) { return typeof x === 'string' ? { kod: x, etykieta: x } : { kod: x.kod || x.wartosc, etykieta: x.etykieta || x.opis || x.kod }; });
    return Object.keys(s).map(function (k) { return { kod: k, etykieta: s[k] }; });
  }
  /** Kod TERC, gdy cały eksport dotyczy jednej gminy (konwencja nazw plików z arkusza metadanych wzorca). */
  function jednaGmina() {
    let t = null;
    for (let i = 0; i < st.eksport.length; i++) {
      const k = st.eksport[i].kod_terc_gminy;
      if (typeof k !== 'string' || !/^\d{7}$/.test(k) || (t && k !== t)) return null;
      t = k;
    }
    return t;
  }
  function nazwaPliku(kod) {
    if (kod === 'datapackage') return 'datapackage.json';
    const roz = { csv: 'csv', xlsx: 'xlsx', json: 'json', geojson: 'geojson', rejestr: 'csv', xml: 'xml' }[kod];
    const przed = { rejestr: 'aed_rejestr_zrodel', xml: 'aed_metadane' }[kod] || 'aed';
    try {
      const n = E() && E().nazwaPliku ? E().nazwaPliku(roz, null, { przedrostek: przed, terc: jednaGmina() }) : null;
      if (n) return n;
    } catch (e) { /* nazwa zapasowa niżej */ }
    const d = new Date().toISOString().slice(0, 10);
    return { rejestr: 'aed_rejestr_zrodel_' + d + '.csv', datapackage: 'datapackage.json', xml: 'aed_metadane_' + d + '.xml' }[kod] || ('aed_' + d + '.' + roz);
  }

  // ------------------------------------------------------------ wynik i opcje
  /** Wynik scalenia (leniwy w magazynie). */
  function bazowy() {
    const x = store.wynik;
    if (Array.isArray(x)) return { rekordy: x, raport: store.raportScalenia || null };
    if (x && x.rekordy) return x;
    return store.przeliczWynik ? store.przeliczWynik(true) : { rekordy: store.rekordy || [], raport: null };
  }
  /** Rekordy z błędami: problemy z kroku 3, a od nowa walidujemy tylko rekordy zmienione przy scalaniu
      (scalone i te z nowym id_aed). Bez wyniku kroku 3 – walidacja całości. */
  function policzBledne(w) {
    const W = AED.walidacja;
    const bledne = new Set();
    if (!W) return bledne;
    const krok3 = AED.ui.walidacja && AED.ui.walidacja.stan;
    const noweId = new Set(((w.raport && w.raport.noweId) || []).map(function (x) { return x.rekordId; }));
    if (!krok3 || !krok3.gotowe || !krok3.problemy || !W.walidujRekord) {
      const r = W.waliduj ? (W.waliduj(w.rekordy) || {}) : {};
      (r.problemy || []).forEach(function (p) { if (p.poziom === 'blad') bledne.add(p.rekordId); });
      return bledne;
    }
    w.rekordy.forEach(function (r) {
      const lista = (r._scalony || noweId.has(r._id)) ? (W.walidujRekord(r) || []) : (krok3.problemy.get(r._id) || []);
      if (lista.some(function (p) { return p.poziom === 'blad'; })) bledne.add(r._id);
    });
    return bledne;
  }
  function przelicz() {
    st.wynik = bazowy();
    st.bledne = policzBledne(st.wynik);
    st.brudne = false;
    mapaWyn.dopasowano = false;
    filtruj();
  }
  function filtruj() {
    st.eksport = (st.wynik ? st.wynik.rekordy : []).filter(function (r) {
      return !(st.pominBledy && st.bledne.has(r._id));
    });
  }
  function licencja() {
    if (!E() || !E().licencjaZbioru) return {};
    try { return E().licencjaZbioru(st.eksport, store.zrodla) || {}; } catch (e) { console.error(e); return {}; }
  }

  /** Obszar zbioru do tytułu: jedna miejscowość, kilka miejscowości albo województwo. */
  function obszar(rekordy) {
    const m = new Map(), w = new Set();
    rekordy.forEach(function (r) {
      if (r.miejscowosc) m.set(String(r.miejscowosc), (m.get(String(r.miejscowosc)) || 0) + 1);
      if (r.wojewodztwo) w.add(String(r.wojewodztwo));
    });
    const miejsca = Array.from(m.keys()).sort(function (a, b) { return m.get(b) - m.get(a); });
    if (miejsca.length === 1) return miejsca[0];
    if (miejsca.length > 1 && miejsca.length <= 3) return miejsca.join(', ');
    if (w.size === 1) return 'województwo ' + Array.from(w)[0];
    if (miejsca.length > 3) return miejsca.slice(0, 3).join(', ') + ' i inne';
    return 'Polska';
  }
  function slug(t) {
    return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /** Identyfikator zbioru: do 28 znaków (zostaje miejsce na przyrostek zasobu „-geojson” w limicie 36), cięty na granicy słowa. */
  function identyfikator(ob) {
    let t = 'aed-' + slug(ob);
    if (t.length > 28) { t = t.slice(0, 28); t = t.slice(0, t.lastIndexOf('-')); }
    return t || 'aed';
  }

  function domyslneMetadane() {
    const ob = obszar(st.eksport);
    const n = store.zrodla.length;
    return {
      tytul: 'Defibrylatory AED – ' + ob,
      tytulEn: 'AED defibrillators – ' + ob,
      opis: 'Lokalizacje automatycznych defibrylatorów zewnętrznych (AED) – ' + ob + '. Zbiór połączono z ' + n + ' ' +
        odmiana(n, 'źródła', 'źródeł', 'źródeł') + ' i ujednolicono według wzorcowego zakresu danych o AED. ' +
        'Każdy rekord ma stały identyfikator id_aed, źródło pochodzenia i licencję. Lista źródeł jest w pliku rejestru źródeł.',
      opisEn: '',
      czestotliwosc: 'monthly',
      kategorie: ['HEAL'],
      slowaKluczowe: ['AED', 'defibrylator', 'pierwsza pomoc', 'ratownictwo', 'zdrowie', 'wzorzec-aed'],
      extIdent: identyfikator(ob),
      url: '',
      adresZasobow: ''
    };
  }
  /** Domyślne wartości odświeżamy tylko w polach, których użytkownik nie zmienił. */
  function aktualizujDomyslne() {
    const d = domyslneMetadane();
    if (!st.metadane) { st.metadane = d; return; }
    Object.keys(d).forEach(function (k) { if (!st.edytowane[k]) st.metadane[k] = d[k]; });
  }

  // ------------------------------------------------------------ podsumowanie i licencja
  function statystyka(n, opis, klasa) {
    return h('li', { class: 'stat' + (klasa ? ' ' + klasa : '') }, h('span', { class: 'stat__liczba' }, liczba(n)), h('span', { class: 'stat__opis' }, opis));
  }

  function renderujPodsumowanie() {
    const kont = $('wyn-podsumowanie');
    kont.textContent = '';
    const wej = store.liczbaRekordowWynik !== undefined ? store.liczbaRekordowWynik : (store.rekordy || []).length;
    const po = st.wynik.rekordy.length;
    const rap = st.wynik.raport || {};
    const nz = store.zrodla.length;
    kont.appendChild(h('ul', { class: 'stat-row', 'aria-label': 'Podsumowanie zbioru' },
      statystyka(wej, odmiana(wej, 'rekord wejściowy', 'rekordy wejściowe', 'rekordów wejściowych')),
      statystyka(po, 'po scaleniu duplikatów', 'stat--ok'),
      statystyka(nz, odmiana(nz, 'źródło', 'źródła', 'źródeł')),
      statystyka(st.bledne.size, odmiana(st.bledne.size, 'rekord z błędami', 'rekordy z błędami', 'rekordów z błędami'), st.bledne.size ? 'stat--err' : null),
      statystyka(st.eksport.length, 'w eksporcie')));

    const dup = store.duplikaty;
    if (!dup) {
      kont.appendChild(h('div', { class: 'alert alert--warn' }, h('p', null, 'Nie wyszukano duplikatów. Zbiór może zawierać to samo urządzenie kilka razy. ',
        h('a', { href: '#walidacja' }, 'Wróć do kroku 3 i wyszukaj duplikaty'), '.')));
    } else {
      const D = store.decyzje || {};
      const bez = (dup.grupy || []).filter(function (g) { return !D[g.id] && g.pewnosc !== 'wysoka'; }).length;
      kont.appendChild(h('p', null, 'Scalono ' + liczba(rap.scalone || 0) + ' ' + odmiana(rap.scalone || 0, 'grupę', 'grupy', 'grup') +
        ' duplikatów (' + liczba(rap.usuniete || Math.max(0, wej - po)) + ' ' + odmiana(rap.usuniete || Math.max(0, wej - po), 'rekord połączony', 'rekordy połączone', 'rekordów połączonych') +
        ' z innymi). Jako różne urządzenia zostawiono ' + liczba(rap.rozdzielone || 0) + ' ' + odmiana(rap.rozdzielone || 0, 'grupę', 'grupy', 'grup') + '.'));
      const nowe = rap.noweId || [];
      if (nowe.length) {
        kont.appendChild(h('div', { class: 'alert alert--warn' },
          h('p', null, liczba(nowe.length) + ' ' + odmiana(nowe.length, 'rekordowi', 'rekordom', 'rekordom') +
            ' nadaliśmy nowy identyfikator id_aed. Miały taki sam identyfikator jak inne urządzenie, a zdecydowano, że to różne urządzenia. ' +
            'Przekaż nowe identyfikatory dysponentom, aby używali ich przy kolejnych aktualizacjach.'),
          h('details', null, h('summary', null, 'Pokaż zmienione identyfikatory'),
            h('ul', { class: 'wyn-noweid' }, nowe.slice(0, 100).map(function (x) {
              const r = store.rekord ? store.rekord(x.rekordId) : null;
              return h('li', null, r ? h('code', null, r._kodZrodla) : null, r ? ', wiersz ' + r._wiersz + ': ' : '',
                h('code', null, String(x.stare || '—')), ' → ', h('code', null, String(x.nowe || '—')), x.powod ? ' (' + x.powod + ')' : null);
            })),
            nowe.length > 100 ? h('p', { class: 'meta' }, 'Pokazano 100 z ' + liczba(nowe.length) + '. Wszystkie są w pliku z danymi.') : null)));
      }
      if (bez) kont.appendChild(h('p', { class: 'alert alert--warn' }, liczba(bez) + ' ' + odmiana(bez, 'grupa', 'grupy', 'grup') +
        ' o średniej lub niskiej pewności nie ma decyzji – rekordy zostały osobno. ', h('a', { href: '#walidacja' }, 'Przejrzyj je w kroku 3'), '.'));
    }

    // opcje eksportu
    const opcje = h('fieldset', { class: 'radio-group wyn-opcje' }, h('legend', null, 'Co trafi do plików'),
      h('div', { class: 'radio' },
        h('input', { type: 'checkbox', id: 'wyn-pomin-bledy', checked: st.pominBledy, 'aria-describedby': 'wyn-pomin-bledy-pomoc',
          onchange: function (e) { st.pominBledy = e.target.checked; poZmianieOpcji(e.target.id, e.target.checked ? 'Rekordy z błędami zostaną pominięte.' : 'Rekordy z błędami zostaną dołączone.'); } }),
        h('label', { for: 'wyn-pomin-bledy' }, 'Pomiń rekordy z błędami w eksporcie')),
      h('p', { class: 'hint', id: 'wyn-pomin-bledy-pomoc' }, 'Domyślnie dołączamy wszystkie rekordy. Rekordy z błędami mogą nie spełniać wzorca, ale ich pominięcie oznacza, że tych urządzeń nie będzie w zbiorze.'));
    kont.appendChild(opcje);
    const bledneWEksporcie = st.eksport.filter(function (r) { return st.bledne.has(r._id); }).length;
    if (bledneWEksporcie) {
      kont.appendChild(h('p', { class: 'alert alert--warn', id: 'wyn-ostrz-bledy' }, 'Eksport zawiera ' + liczba(bledneWEksporcie) + ' ' +
        odmiana(bledneWEksporcie, 'rekord z błędami', 'rekordy z błędami', 'rekordów z błędami') + '. Możesz je opublikować, ale zalecamy najpierw ',
        h('a', { href: '#walidacja' }, 'poprawić je w kroku 3'), '.'));
    }
    if (!st.eksport.length) kont.appendChild(h('p', { class: 'alert alert--err' }, 'Po zastosowaniu opcji nie zostały żadne rekordy do eksportu.'));
  }

  function poZmianieOpcji(idPola, komunikat) {
    filtruj();
    aktualizujDomyslne();
    renderujPodsumowanie(); renderujMape(); renderujLicencje(); renderujPliki(); renderujPodglad();
    odswiezPolaMetadanych();
    const el = $(idPola); if (el) el.focus();
    oglos(komunikat + ' W eksporcie: ' + liczba(st.eksport.length) + ' ' + odmiana(st.eksport.length, 'rekord', 'rekordy', 'rekordów') + '.');
  }

  function renderujLicencje() {
    const kont = $('wyn-licencja');
    kont.textContent = '';
    if (!E() || !E().licencjaZbioru) { kont.appendChild(h('p', { class: 'alert alert--err' }, 'Nie wczytano modułu eksportu (js/core/eksport.js).')); return; }
    let lic;
    lic = licencja();
    const kod = String(lic.kod || '');
    const atr = lic.atrybucje || [];
    kont.appendChild(h('dl', { class: 'dl-grid' },
      h('dt', null, 'Licencja'), h('dd', null, h('strong', null, lic.nazwa || kod || '—'), kod && lic.nazwa ? ' (' + kod + ')' : null),
      h('dt', null, 'Dlaczego ta licencja'), h('dd', null, lic.uzasadnienie || '—'),
      h('dt', null, 'Wymagane atrybucje'), h('dd', null, atr.length
        ? h('ul', { class: 'wyn-atrybucje' }, atr.map(function (a) { return h('li', null, typeof a === 'string' ? a : (a.tekst || a.nazwa || JSON.stringify(a))); }))
        : 'Brak – nie trzeba podawać źródła (ale to dobra praktyka).')));
    if (/by/i.test(kod)) {
      kont.appendChild(h('p', { class: 'note' }, 'CC BY 4.0: każdy może używać danych, także komercyjnie, pod warunkiem podania źródła (atrybucji). ' +
        'Atrybucje wymienione wyżej wpisz w opisie zbioru.'));
    } else if (/cc0/i.test(kod)) {
      kont.appendChild(h('p', { class: 'note' }, 'CC0 1.0: dane są w domenie publicznej. Każdy może ich używać bez żadnych warunków.'));
    }
  }

  // ------------------------------------------------------------ metadane
  const POLA_META = [
    { klucz: 'tytul', etykieta: 'Tytuł zbioru (po polsku)', wymagane: true, typ: 'text', pomoc: 'Krótko: co i gdzie. Np. „Defibrylatory AED – Krosno”.' },
    { klucz: 'tytulEn', etykieta: 'Tytuł zbioru (po angielsku)', typ: 'text', lang: 'en' },
    { klucz: 'opis', etykieta: 'Opis zbioru (po polsku)', wymagane: true, typ: 'textarea', pomoc: 'Co zawiera zbiór, skąd pochodzą dane, kogo trzeba wymienić jako źródło, gdzie zgłaszać błędy.' },
    { klucz: 'opisEn', etykieta: 'Opis zbioru (po angielsku)', typ: 'textarea', lang: 'en' },
    { klucz: 'czestotliwosc', etykieta: 'Częstotliwość aktualizacji', wymagane: true, typ: 'select' },
    { klucz: 'slowaKluczowe', etykieta: 'Słowa kluczowe', wymagane: true, typ: 'text', pomoc: 'Oddziel przecinkami.' },
    { klucz: 'extIdent', etykieta: 'Identyfikator zbioru w Twoim systemie', wymagane: true, typ: 'text', pomoc: 'Do 36 znaków. Nie zmieniaj go przy kolejnych aktualizacjach.' },
    { klucz: 'url', etykieta: 'Adres strony zbioru (opcjonalnie)', typ: 'url', pomoc: 'Np. strona BIP lub serwisu urzędu, na której opisano zbiór.' },
    { klucz: 'adresZasobow', etykieta: 'Adres, pod którym opublikujesz pliki (tylko dla harvestera)', typ: 'url',
      pomoc: 'Katalog na serwerze urzędu, np. https://www.urzad.example.pl/dane/aed/. Musi zaczynać się od https://. Na tej podstawie powstaną adresy plików w metadanych XML.' }
  ];
  const ETYKIETA = {};
  POLA_META.forEach(function (p) { ETYKIETA[p.klucz] = p.etykieta; });

  function idPola(k) { return 'wyn-m-' + k; }

  /** Metadane w postaci dla AED.eksport (walidujMetadane, metadaneXml, datapackage). */
  function metadaneEksportu() {
    const m = Object.assign({}, st.metadane);
    const lic = licencja();
    m.licencja = lic.kod ? lic : null;
    m.zrodla = store.zrodla;
    m.dataAktualizacji = new Date();
    m.warunki = { zrodlo: !!(lic.atrybucje && lic.atrybucje.length) };
    if (lic.licencjaXml) { m.warunki.licencja = lic.licencjaXml; m.warunki.bazaDanych = AED.eksport.warunekBazyDanych(lic.licencjaXml); }
    delete m.adresZasobow;
    return m;
  }
  /** Pole formularza, przy którym pokazać problem z walidujMetadane. */
  function poleProblemu(pole) {
    pole = String(pole || '');
    if (ETYKIETA[pole]) return pole;
    if (/^zasoby\.\d+\.url$/.test(pole) || pole === 'zasoby') return 'adresZasobow';
    return null;
  }

  function odczytajFormularz() {
    const m = st.metadane;
    POLA_META.forEach(function (p) {
      const el = $(idPola(p.klucz));
      if (!el) return;
      m[p.klucz] = p.klucz === 'slowaKluczowe'
        ? el.value.split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean)
        : el.value.trim();
    });
    return m;
  }
  function wartoscPola(k) {
    const v = st.metadane[k];
    return Array.isArray(v) ? v.join(', ') : (v || '');
  }

  function poleFormularza(p) {
    const id = idPola(p.klucz);
    const opis = [p.pomoc ? id + '-pomoc' : null, id + '-blad'].filter(Boolean).join(' ');
    const etykieta = [p.etykieta, p.wymagane ? h('span', { class: 'wymagane', 'aria-hidden': 'true' }, ' *') : null];
    const zmiana = function () { st.edytowane[p.klucz] = true; if (st.sprawdzono) sprawdzMetadane(false); };
    let ctrl;
    if (p.typ === 'select') {
      ctrl = h('select', { id: id, required: p.wymagane || null, 'aria-describedby': opis, onchange: zmiana },
        slownik('czestotliwosc', CZESTOTLIWOSC).map(function (c) { return h('option', { value: c.kod, selected: c.kod === st.metadane[p.klucz] }, c.etykieta); }));
    } else if (p.typ === 'textarea') {
      ctrl = h('textarea', { id: id, rows: 5, required: p.wymagane || null, lang: p.lang || null, 'aria-describedby': opis, onchange: zmiana });
      ctrl.value = wartoscPola(p.klucz);
    } else {
      ctrl = h('input', { type: p.typ === 'url' ? 'url' : 'text', id: id, value: wartoscPola(p.klucz), required: p.wymagane || null,
        lang: p.lang || null, autocomplete: 'off', spellcheck: p.typ === 'url' || p.klucz === 'extIdent' ? 'false' : null,
        'aria-describedby': opis, onchange: zmiana });
    }
    return h('div', { class: 'field' },
      h('label', { for: id }, etykieta),
      p.pomoc ? h('p', { class: 'hint', id: id + '-pomoc' }, p.pomoc) : null,
      ctrl,
      h('p', { class: 'field-error', id: id + '-blad', hidden: true }));
  }

  function renderujMetadane() {
    const kont = $('wyn-metadane');
    kont.textContent = '';
    kont.appendChild(h('div', { id: 'wyn-m-podsumowanie' }));
    kont.appendChild(h('form', { class: 'wyn-metadane', id: 'wyn-m-form', novalidate: true, 'aria-labelledby': 'h-wyn-metadane',
      onsubmit: function (e) { e.preventDefault(); sprawdzMetadane(true); } },
      POLA_META.map(poleFormularza),
      h('div', { class: 'alert-actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'Sprawdź metadane'),
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: function () {
          st.edytowane = {}; st.metadane = null; aktualizujDomyslne(); st.sprawdzono = false; st.problemy = [];
          renderujMetadane(); $(idPola('tytul')).focus(); oglos('Przywrócono podpowiedziane wartości metadanych.');
        } }, 'Przywróć podpowiedzi'))));
  }

  /** Podpowiedzi zmienione przez opcje eksportu – tylko w polach, których nie edytowano. */
  function odswiezPolaMetadanych() {
    POLA_META.forEach(function (p) {
      if (st.edytowane[p.klucz] || p.typ === 'checkbox' || p.typ === 'select') return;
      const el = $(idPola(p.klucz));
      if (el) el.value = wartoscPola(p.klucz);
    });
  }

  /** Problemy metadanych bez zmian w interfejsie (np. do gotowości wysyłki). Wymaga st.metadane. */
  function problemyMetadanych(zZasobami) {
    let problemy = [];
    const doSprawdzenia = zZasobami || st.metadane.adresZasobow ? zasoby() : undefined;
    try { problemy = (E() && E().walidujMetadane) ? (E().walidujMetadane(metadaneEksportu(), doSprawdzenia) || []) : []; } catch (e) { console.error(e); }
    // problemy zasobów przypisujemy do pola adresu plików; ten sam komunikat pokazujemy raz
    const widziane = new Set();
    problemy = problemy.map(function (x) {
      const y = Object.assign({}, x, { pole: poleProblemu(x.pole) || x.pole });
      if (y.pole === 'adresZasobow' && x.pole !== 'adresZasobow') {
        y.komunikat = y.kod === 'WYMAGANE' ? 'Wpisz adres, pod którym opublikujesz pliki (https://…) – jest potrzebny w pliku XML.'
          : 'Adres plików musi zaczynać się od https:// i nie może zawierać spacji.';
      }
      return y;
    }).filter(function (x) {
      const k = x.pole + '|' + x.komunikat;
      if (widziane.has(k)) return false;
      widziane.add(k); return true;
    });
    return problemy;
  }

  /** Walidacja metadanych (AED.eksport.walidujMetadane). Zwraca true, gdy nie ma błędów. */
  function sprawdzMetadane(zFokusem, zZasobami) {
    odczytajFormularz();
    const problemy = problemyMetadanych(zZasobami);
    st.problemy = problemy;
    st.sprawdzono = true;
    const bledy = problemy.filter(function (p) { return p.poziom !== 'ostrzezenie'; });
    const ostrz = problemy.filter(function (p) { return p.poziom === 'ostrzezenie'; });
    // błędy przy polach
    POLA_META.forEach(function (p) {
      const id = idPola(p.klucz);
      const el = $(id), b = $(id + '-blad');
      if (!el || !b) return;
      const moje = problemy.filter(function (x) { return x.pole === p.klucz; });
      if (moje.length) {
        b.textContent = '';
        b.appendChild(AED.dom.ikona(moje.some(function (x) { return x.poziom !== 'ostrzezenie'; }) ? 'err' : 'warn'));
        b.appendChild(document.createTextNode(moje.map(function (x) { return x.komunikat; }).join(' ')));
        b.hidden = false;
        if (moje.some(function (x) { return x.poziom !== 'ostrzezenie'; })) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      } else {
        b.hidden = true; b.textContent = '';
        el.removeAttribute('aria-invalid');
      }
    });
    // podsumowanie na górze
    const kont = $('wyn-m-podsumowanie');
    kont.textContent = '';
    if (bledy.length || ostrz.length) {
      const link = function (p) {
        const cel = ETYKIETA[p.pole] ? idPola(p.pole) : 'wyn-m-form';
        return h('li', null, h('a', { href: '#' + cel, onclick: function (e) {
          e.preventDefault(); // #hash służy routerowi – przenosimy tylko fokus
          const el = $(cel);
          const f = el && (el.matches('fieldset') ? el.querySelector('input') : el);
          if (f) { f.focus(); f.scrollIntoView({ block: 'center' }); }
        } }, (ETYKIETA[p.pole] ? ETYKIETA[p.pole] + ': ' : '') + p.komunikat));
      };
      kont.appendChild(h('div', { class: 'alert ' + (bledy.length ? 'alert--err' : 'alert--warn') },
        h('h3', { id: 'wyn-m-bledy', tabindex: '-1' }, bledy.length
          ? 'Popraw ' + liczba(bledy.length) + ' ' + odmiana(bledy.length, 'błąd', 'błędy', 'błędów') + ' w metadanych'
          : 'Metadane są poprawne, ale warto przejrzeć ' + liczba(ostrz.length) + ' ' + odmiana(ostrz.length, 'uwagę', 'uwagi', 'uwag')),
        h('ul', null, bledy.concat(ostrz).map(link))));
      if (zFokusem) { $('wyn-m-bledy').focus(); }
    } else {
      kont.appendChild(h('p', { class: 'alert alert--ok', id: 'wyn-m-ok', tabindex: '-1' }, 'Metadane są kompletne. Możesz pobrać plik XML i datapackage.json.'));
      if (zFokusem) $('wyn-m-ok').focus();
    }
    if (zFokusem) oglos(bledy.length ? 'W metadanych jest ' + liczba(bledy.length) + ' ' + odmiana(bledy.length, 'błąd', 'błędy', 'błędów') + '.' : 'Metadane są kompletne.');
    return !bledy.length;
  }

  // ------------------------------------------------------------ pliki
  function zasoby() {
    const baza = String(st.metadane.adresZasobow || '').trim();
    const zUkosnikiem = baza && !/\/$/.test(baza) ? baza + '/' : baza;
    const tytul = st.metadane.tytul || 'Defibrylatory AED';
    return ['csv', 'xlsx', 'json', 'geojson', 'rejestr'].map(function (kod) {
      const def = PLIKI.find(function (p) { return p.kod === kod; });
      const plik = nazwaPliku(kod);
      return {
        nazwa: kod === 'rejestr' ? 'rejestr-zrodel' : 'aed-' + kod,
        kod: kod,
        plik: plik,
        sciezka: plik,
        format: kod === 'rejestr' ? 'csv' : kod,
        typ: def.typ.split(';')[0],
        tytul: kod === 'rejestr' ? 'Rejestr źródeł – ' + tytul : tytul + ' – ' + FORMAT[kod],
        opis: OPIS_ZASOBU[kod],
        url: zUkosnikiem ? zUkosnikiem + plik : '',
        extIdent: (st.metadane.extIdent || 'aed').slice(0, 36 - kod.length - 1) + '-' + kod,
        dataDanych: new Date(),
        regiony: kod === 'rejestr' || !E().regiony ? undefined : E().regiony(st.eksport)
      };
    });
  }

  function tresc(kod) {
    const e = E();
    const r = st.eksport;
    switch (kod) {
      case 'csv': return e.csv(r);
      case 'csv-excel': return e.csv(r, { bom: true });
      case 'xlsx': return e.xlsx(r, { metadane: st.metadane, zrodla: store.zrodla });
      case 'json': return tekst(e.json(r));
      case 'geojson': return tekst(e.geojson(r, { tylkoZeWspolrzednymi: true }));
      case 'rejestr': { const x = e.rejestrZrodel(store.zrodla, r); return typeof x === 'string' ? x : x.csv; }
      case 'datapackage': return tekst(e.datapackage(metadaneEksportu(), zasoby()));
      case 'xml': return e.metadaneXml(metadaneEksportu(), zasoby());
    }
    return '';
  }

  function pobierzPlik(def) {
    st.bledyPobrania[def.kod] = null;
    if (def.metadane && !sprawdzMetadane(false, def.kod === 'xml')) {
      st.bledyPobrania[def.kod] = 'Nie pobrano: najpierw popraw błędy w metadanych (lista nad formularzem).';
      renderujPliki();
      const b = $('wyn-m-bledy'); if (b) b.focus();
      oglos(st.bledyPobrania[def.kod], true);
      return;
    }
    const nazwa = def.kod === 'csv-excel' ? nazwaPliku('csv').replace(/\.csv$/, '_excel.csv') : nazwaPliku(def.kod);
    const kontId = 'wyn-p-' + (def.kod === 'csv-excel' ? 'csv' : def.kod) + '-stan';
    const przycisk = $('wyn-p-' + def.kod);
    if (przycisk && przycisk.getAttribute('aria-disabled') === 'true') return;
    const stanEl = $(kontId);
    if (stanEl) { stanEl.hidden = false; stanEl.textContent = 'Przygotowuję plik ' + nazwa + '…'; }
    if (przycisk) { przycisk.setAttribute('aria-disabled', 'true'); przycisk.classList.add('is-busy'); }
    if (st.eksport.length > 5000) oglos('Przygotowuję plik ' + nazwa + '. Przy dużym zbiorze może to potrwać kilka sekund.');
    // przeglądarka najpierw pokazuje komunikat, dopiero potem generujemy plik (XLSX dla 50 tys. rekordów to kilka sekund)
    setTimeout(function () { generujIPobierz(def, nazwa, kontId, przycisk); }, 30);
  }

  function generujIPobierz(def, nazwa, kontId, przycisk) {
    const zwolnijPrzycisk = function () { if (przycisk) { przycisk.removeAttribute('aria-disabled'); przycisk.classList.remove('is-busy'); } };
    try {
      const dane = tresc(def.kod);
      const n = pobierz(nazwa, dane, def.typ);
      st.pobrane[def.kod === 'csv-excel' ? 'csv' : def.kod] = { nazwa: nazwa, rozmiar: n };
      const el = $(kontId);
      if (el) { el.hidden = false; el.textContent = 'Pobrano plik ' + nazwa + ' (' + rozmiar(n) + ').'; }
      oglos('Pobrano plik ' + nazwa + ', ' + rozmiar(n) + '.');
      zwolnijPrzycisk();
    } catch (err) {
      zwolnijPrzycisk();
      console.error(err);
      st.bledyPobrania[def.kod] = 'Nie udało się przygotować pliku: ' + (err && err.message ? err.message : err);
      renderujPliki();
      const b = $('wyn-p-' + def.kod); if (b) b.focus();
      oglos(st.bledyPobrania[def.kod], true);
    }
  }

  function renderujPliki() {
    const kont = $('wyn-pliki');
    kont.textContent = '';
    if (!E()) { kont.appendChild(h('p', { class: 'alert alert--err' }, 'Nie wczytano modułu eksportu (js/core/eksport.js).')); return; }
    kont.appendChild(h('p', null, 'Pliki powstają w Twojej przeglądarce. W eksporcie: ' + liczba(st.eksport.length) + ' ' +
      odmiana(st.eksport.length, 'rekord', 'rekordy', 'rekordów') + '.'));
    kont.appendChild(h('ul', { class: 'pliki' }, PLIKI.map(function (def) {
      const blad = st.bledyPobrania[def.kod];
      const pob = st.pobrane[def.kod];
      return h('li', { class: 'plik' + (def.zalecany ? ' plik--zalecany' : '') },
        h('div', { class: 'plik__opis' },
          h('h3', { class: 'plik__nazwa', id: 'wyn-p-' + def.kod + '-n' }, def.nazwa, def.zalecany ? [' ', odznaka('ok', 'Zalecany')] : null),
          h('p', { class: 'meta', id: 'wyn-p-' + def.kod + '-o' }, def.opis)),
        h('div', { class: 'plik__akcje' },
          h('button', { type: 'button', class: 'btn ' + (def.zalecany ? 'btn--primary' : 'btn--secondary') + ' btn--small', id: 'wyn-p-' + def.kod,
            disabled: !st.eksport.length && !def.metadane ? true : null,
            'aria-describedby': 'wyn-p-' + def.kod + '-o' + (blad ? ' wyn-p-' + def.kod + '-blad' : ''),
            onclick: function () { pobierzPlik(def); } }, 'Pobierz', h('span', { class: 'visually-hidden' }, ' ' + def.nazwa)),
          def.kod === 'csv' ? h('button', { type: 'button', class: 'btn-link', id: 'wyn-p-csv-excel', 'aria-describedby': 'wyn-p-csv-excel-o',
            onclick: function () { pobierzPlik(Object.assign({}, def, { kod: 'csv-excel' })); } }, 'Wersja dla Excela (z BOM)') : null,
          def.kod === 'csv' ? h('p', { class: 'hint', id: 'wyn-p-csv-excel-o' }, 'Excel w Windows poprawnie pokaże polskie znaki. Do portalu wgraj zwykły CSV.') : null,
          h('p', { class: 'meta', id: 'wyn-p-' + def.kod + '-stan', hidden: !pob }, pob ? 'Pobrano plik ' + pob.nazwa + ' (' + rozmiar(pob.rozmiar) + ').' : ''),
          blad ? h('p', { class: 'field-error', id: 'wyn-p-' + def.kod + '-blad' }, blad) : null));
    })));
  }

  function renderujPodglad() {
    const kont = $('wyn-podglad');
    kont.textContent = '';
    if (!E() || !st.eksport.length) { kont.appendChild(h('p', { class: 'empty' }, 'Brak rekordów do pokazania.')); return; }
    let wiersze;
    try {
      const csv = E().csv(st.eksport.slice(0, 10));
      wiersze = Papa.parse(String(csv).replace(/^﻿/, ''), { skipEmptyLines: true }).data;
    } catch (e) { console.error(e); kont.appendChild(h('p', { class: 'alert alert--err' }, 'Nie udało się przygotować podglądu.')); return; }
    const nagl = wiersze[0] || [];
    const tabela = h('table', { class: 'table--data' },
      h('caption', null, 'Pierwsze ' + (wiersze.length - 1) + ' wierszy pliku CSV (' + nagl.length + ' kolumn)'),
      h('thead', null, h('tr', null, nagl.map(function (k) { return h('th', { scope: 'col' }, k); }))),
      h('tbody', null, wiersze.slice(1).map(function (w) { return h('tr', null, w.map(function (v) { return h('td', { title: v.length > 40 ? v : null }, v); })); })));
    kont.appendChild(tabelaPrzewijana('Podgląd pliku CSV', tabela));
  }

  // ------------------------------------------------------------ mapa
  /** Mapa rekordów z eksportu. Tekstowa alternatywa: legenda z liczbami, podgląd CSV i pliki do pobrania. */
  function renderujMape() {
    const kont = $('wyn-mapa');
    const M = AED.ui.mapa;
    if (!kont || !M) return;
    if (!mapaWyn.obiekt) {
      kont.textContent = '';
      const wybor = h('div', { class: 'field mapa__kolor' },
        h('label', { for: 'wyn-mapa-kolor' }, 'Koloruj punkty według'),
        h('select', { id: 'wyn-mapa-kolor', onchange: function (e) {
          st.kolorWg = e.target.value; renderujMape();
          oglos('Kolory punktów według ' + (st.kolorWg === 'zrodlo' ? 'źródła' : 'statusu') + '. Legenda pod mapą.');
        } }, h('option', { value: 'status' }, 'statusu urządzenia'), h('option', { value: 'zrodlo' }, 'źródła danych')));
      mapaWyn.obiekt = M.utworz({ etykieta: 'Mapa punktów zbioru wynikowego',
        opisDodatkowy: 'Kliknięcie punktu pokazuje jego nazwę, adres i źródło. Te same dane są w podglądzie i plikach do pobrania poniżej.' });
      kont.append(wybor, mapaWyn.obiekt.element, h('div', { id: 'wyn-mapa-legenda', class: 'mapa-legenda' }));
      setTimeout(function () { mapaWyn.obiekt.odswiez(); }, 0);
    }
    const ob = mapaWyn.obiekt;
    const kolorZrodla = {};
    store.zrodla.forEach(function (z, i) { kolorZrodla[z.kod] = M.PALETA[i % M.PALETA.length]; });
    const liczniki = new Map();
    const punkty = [];
    let bezWsp = 0;
    let minA = 90, maxA = -90, minB = 180, maxB = -180;
    st.eksport.forEach(function (r) {
      const w = M.wspolrzedne(r);
      if (!w) { bezWsp++; return; }
      const klucz = st.kolorWg === 'zrodlo' ? String(r._kodZrodla || r.zrodlo_danych || '?') : String(r.status || '');
      const kolor = st.kolorWg === 'zrodlo' ? (kolorZrodla[klucz] || '#4a4a4a') : (M.KOLORY_STATUSU[klucz] || M.KOLORY_STATUSU['']);
      liczniki.set(klucz, { kolor: kolor, n: ((liczniki.get(klucz) || {}).n || 0) + 1 });
      punkty.push({ wsp: w, kolor: kolor, rekord: r });
      if (w[0] < minA) minA = w[0]; if (w[0] > maxA) maxA = w[0];
      if (w[1] < minB) minB = w[1]; if (w[1] > maxB) maxB = w[1];
    });
    const leg = $('wyn-mapa-legenda');
    leg.textContent = '';
    leg.appendChild(h('p', { id: 'wyn-mapa-opis' }, 'Na mapie: ' + liczba(punkty.length) + ' ' + odmiana(punkty.length, 'punkt', 'punkty', 'punktów') +
      ' z ' + liczba(st.eksport.length) + ' ' + odmiana(st.eksport.length, 'rekordu', 'rekordów', 'rekordów') + ' w eksporcie' +
      (bezWsp ? '. Bez poprawnych współrzędnych (niewidoczne na mapie): ' + liczba(bezWsp) : '') + '.'));
    if (liczniki.size) {
      leg.appendChild(h('ul', { class: 'mapa-legenda__lista', 'aria-label': 'Legenda mapy – ' + (st.kolorWg === 'zrodlo' ? 'źródła' : 'statusy') },
        Array.from(liczniki.keys()).sort().map(function (k) {
          const x = liczniki.get(k);
          const nazwa = st.kolorWg === 'zrodlo' ? k + ((store.zrodla.find(function (z) { return z.kod === k; }) || {}).nazwa ? ' – ' + store.zrodla.find(function (z) { return z.kod === k; }).nazwa : '')
            : (k ? M.etykietaStatusu(k) : 'brak statusu');
          return h('li', null, h('span', { class: 'mapa-legenda__znak', style: 'background:' + x.kolor, 'aria-hidden': 'true' }),
            nazwa + ': ' + liczba(x.n));
        })));
    }
    if (!ob.mapa) return;
    const sel = $('wyn-mapa-kolor'); if (sel) sel.value = st.kolorWg;
    if (mapaWyn.warstwa) mapaWyn.warstwa.ustaw(punkty);
    else mapaWyn.warstwa = M.warstwaPunktow(ob.mapa, punkty, { popup: function (r) { return M.opisPunktu(r); } });
    if (!mapaWyn.dopasowano && punkty.length) {
      mapaWyn.dopasowano = true;
      setTimeout(function () { ob.odswiez(); ob.dopasuj([[minA, minB], [maxA, maxB]], 15); }, 0);
    }
  }

  // ------------------------------------------------------------ całość
  function renderuj() {
    const brak = $('wyn-brak'), tresc = $('wyn-tresc');
    const n = store.liczbaRekordowWynik !== undefined ? store.liczbaRekordowWynik : (store.rekordy || []).length;
    if (!n) {
      tresc.hidden = true; brak.hidden = false; brak.textContent = '';
      brak.appendChild(h('p', null, 'Nie ma jeszcze rekordów do eksportu. ',
        store.zrodla.length ? h('a', { href: '#walidacja' }, 'Wróć do kroku 3') : h('a', { href: '#zrodla' }, 'Zacznij od dodania źródeł w kroku 1'), '.'));
      return;
    }
    brak.hidden = true; tresc.hidden = false;
    try { if (st.brudne || !st.wynik) przelicz(); } catch (e) {
      console.error(e);
      tresc.hidden = true; brak.hidden = false; brak.textContent = '';
      brak.appendChild(h('p', { class: 'alert alert--err' }, 'Nie udało się przygotować wyniku: ' + (e && e.message ? e.message : e)));
      return;
    }
    const pierwszy = !st.metadane;
    aktualizujDomyslne();
    renderujPodsumowanie();
    try { renderujMape(); } catch (e) { console.error(e); }
    if (mapaWyn.obiekt) setTimeout(function () { mapaWyn.obiekt.odswiez(); }, 0);
    renderujLicencje();
    if (pierwszy || !$('wyn-m-form')) renderujMetadane(); else odswiezPolaMetadanych();
    renderujPliki();
    renderujPodglad();
  }

  function init() {
    AED.on('trasa', function (e) {
      if (e.trasa !== 'wynik') return;
      renderuj();
    });
    // decyzje o scaleniu mogą zmienić liczbę rekordów i licencję zbioru – przy otwartym kroku 4 liczymy od nowa
    // wynik liczymy od nowa tylko po faktycznej zmianie (decyzje, poprawki, nowe wyszukiwanie)
    let zaplanowane = false;
    AED.on('wynik:zmiana', function (e) {
      if (!e || e.akcja !== 'nieaktualny') return;
      st.brudne = true;
      if (AED.router.trasa !== 'wynik' || zaplanowane) return;
      zaplanowane = true;
      setTimeout(function () { zaplanowane = false; if (AED.router.trasa === 'wynik') renderuj(); }, 0);
    });
  }

  AED.ui = AED.ui || {};
  /** Stan kroku 4 dla wysyłki do bazy (AED.gov.gotowosc / zbierzZgloszenie): bieżące metadane z formularza
      (bez pokazywania błędów przy polach), ich problemy i rekordy eksportu. Bez wyniku – metadane null. */
  function stanDlaGov() {
    // wynik nieaktualny (zmiana decyzji, poprawki) – liczymy od nowa, by wysłać to, co widać po odświeżeniu
    if (st.brudne && st.metadane) { try { przelicz(); } catch (e) { console.error(e); } }
    const gotowy = !!(st.metadane && st.wynik && $('wyn-m-form'));
    // stan kroku 3 ({gotowe, nieaktualne, problemy: Map}) – AED.gov sam ocenia aktualność i nie waliduje drugi raz
    const walidacja = (AED.ui.walidacja && AED.ui.walidacja.stan) || undefined;
    if (!gotowy) return { metadane: null, problemyMetadanych: [], rekordy: undefined, walidacja: walidacja, pominBledy: st.pominBledy, liczbaBlednych: 0 };
    odczytajFormularz();
    let problemy = [];
    try { problemy = problemyMetadanych(false); } catch (e) { console.error(e); }
    const m = metadaneEksportu();
    delete m.zrodla; // pełne źródła (z wierszami) zbiera AED.gov ze store – tu tylko opis zbioru
    return {
      metadane: m,
      problemyMetadanych: problemy,
      rekordy: st.eksport,
      walidacja: walidacja,
      pominBledy: st.pominBledy,
      pominieteBledne: st.pominBledy ? st.bledne.size : 0,
      liczbaBlednych: st.eksport.filter(function (r) { return st.bledne.has(r._id); }).length
    };
  }

  AED.ui.wynik = { init: init, renderuj: renderuj, stanDlaGov: stanDlaGov, POLE_METADANYCH: idPola,
    get stan() { return st; }, get mapa() { return mapaWyn.obiekt && mapaWyn.obiekt.mapa; } };
})(window.AED);
