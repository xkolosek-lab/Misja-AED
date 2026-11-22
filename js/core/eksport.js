/* Eksport zbioru wynikowego: CSV, JSON, GeoJSON, XLSX, rejestr źródeł, Data Package, metadane XML dla harvestera dane.gov.pl.
   Formaty wg arkusza „informacje” wzorca i Standardu technicznego dane.gov.pl (2020):
   UTF-8, przecinek, jeden wiersz nagłówka = nazwy pól, CSV wg RFC 4180, kropka dziesiętna, true/false, daty ISO 8601.
   Pola techniczne (zaczynające się od „_”) nigdy nie trafiają do plików. */
(function (AED) {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const SCHEMA = AED.wzorzec.schema;
  const POLA = SCHEMA.fields;
  const POLE = {};
  POLA.forEach(function (f) { POLE[f.name] = f; });
  const WSP = { szerokosc_geograficzna: 1, dlugosc_geograficzna: 1 };
  const LICENCJE = {
    'CC0-1.0': { nazwa: 'CC0 1.0 (domena publiczna)', xml: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.pl', ranga: 0 },
    'CC-BY-4.0': { nazwa: 'CC BY 4.0 (uznanie autorstwa)', xml: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/legalcode.pl', ranga: 1 }
  };

  // Słowniki z otwarte_dane_latest.xsd (harvester dane.gov.pl, wersja 1.13) – do list wyboru w UI
  const SLOWNIKI_XML = {
    czestotliwosc: [
      { kod: 'daily', etykieta: 'Codziennie' }, { kod: 'weekly', etykieta: 'Co tydzień' }, { kod: 'monthly', etykieta: 'Co miesiąc' },
      { kod: 'quarterly', etykieta: 'Co kwartał' }, { kod: 'everyHalfYear', etykieta: 'Co pół roku' }, { kod: 'yearly', etykieta: 'Co rok' },
      { kod: 'irregular', etykieta: 'Nieregularnie' }, { kod: 'notPlanned', etykieta: 'Jednorazowe udostępnienie' }
    ],
    kategorie: [
      { kod: 'AGRI', etykieta: 'Rolnictwo, rybołówstwo, leśnictwo i żywność' }, { kod: 'EDUC', etykieta: 'Edukacja, kultura i sport' },
      { kod: 'ENVI', etykieta: 'Środowisko' }, { kod: 'ENER', etykieta: 'Energia' }, { kod: 'TRAN', etykieta: 'Transport' },
      { kod: 'TECH', etykieta: 'Nauka i technologia' }, { kod: 'ECON', etykieta: 'Gospodarka i finanse' },
      { kod: 'SOCI', etykieta: 'Ludność i społeczeństwo' }, { kod: 'HEAL', etykieta: 'Zdrowie' },
      { kod: 'GOVE', etykieta: 'Rząd i sektor publiczny' }, { kod: 'REGI', etykieta: 'Regiony i miasta' },
      { kod: 'JUST', etykieta: 'Sprawiedliwość, ustrój sądów i bezpieczeństwo publiczne' }, { kod: 'INTR', etykieta: 'Kwestie międzynarodowe' }
    ],
    licencje: [
      { kod: 'CC0 1.0', etykieta: 'CC0 1.0 – domena publiczna', url: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.pl' },
      { kod: 'CC BY 4.0', etykieta: 'CC BY 4.0 – uznanie autorstwa', url: 'https://creativecommons.org/licenses/by/4.0/legalcode.pl' },
      { kod: 'CC BY-SA 4.0', etykieta: 'CC BY-SA 4.0 – na tych samych warunkach', url: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode.pl' },
      { kod: 'CC BY-NC 4.0', etykieta: 'CC BY-NC 4.0 – użycie niekomercyjne', url: 'https://creativecommons.org/licenses/by-nc/4.0/legalcode.pl' },
      { kod: 'CC BY-NC-SA 4.0', etykieta: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.pl' },
      { kod: 'CC BY-ND 4.0', etykieta: 'CC BY-ND 4.0 – bez utworów zależnych', url: 'https://creativecommons.org/licenses/by-nd/4.0/legalcode.pl' },
      { kod: 'CC BY-NC-ND 4.0', etykieta: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode.pl' }
    ],
    dostepnosc: [
      { kod: 'local', etykieta: 'Plik kopiowany do repozytorium dane.gov.pl' },
      { kod: 'remote', etykieta: 'Plik udostępniany z adresu dostawcy' }
    ],
    status: [{ kod: 'published', etykieta: 'Opublikowany' }, { kod: 'draft', etykieta: 'Szkic (niewidoczny)' }],
    jezyki: [{ kod: 'pl', etykieta: 'polski' }, { kod: 'en', etykieta: 'angielski' }]
  };
  const KODY_XML = {};
  Object.keys(SLOWNIKI_XML).forEach(function (k) { KODY_XML[k] = SLOWNIKI_XML[k].map(function (x) { return x.kod; }); });

  // ------------------------------------------------------------ pomocnicze
  function pusta(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }
  /** Date także z innego okna/ramki (instanceof zawodzi między kontekstami). */
  function jestData(d) { return Object.prototype.toString.call(d) === '[object Date]' && !isNaN(d); }
  function dwie(n) { return (n < 10 ? '0' : '') + n; }
  function dataIso(d) {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    d = jestData(d) ? d : new Date();
    return d.getFullYear() + '-' + dwie(d.getMonth() + 1) + '-' + dwie(d.getDate());
  }
  function dataCzasIso(d) {
    d = jestData(d) ? d : new Date();
    return dataIso(d) + 'T' + dwie(d.getHours()) + ':' + dwie(d.getMinutes()) + ':' + dwie(d.getSeconds());
  }
  function zaokr6(v) { return Math.round(v * 1e6) / 1e6; }

  function kolumny() { return POLA.map(function (f) { return f.name; }); }

  /** Wartość pola w postaci tekstu do CSV/XLSX: liczby z kropką (bez wykładnika), true/false, puste = ''. */
  function tekstPola(pole, v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') {
      if (!isFinite(v)) return '';
      const x = WSP[pole] ? zaokr6(v) : v;
      let s = String(x);
      if (/e/i.test(s)) s = x.toFixed(WSP[pole] ? 6 : 10).replace(/\.?0+$/, '');
      return s;
    }
    if (jestData(v)) return dataIso(v);
    return String(v);
  }
  // Ochrona przed CSV injection: tekst zaczynający się od = + - @ (lub tab/CR) poprzedzamy apostrofem.
  // NIE dotyczy liczb i tekstów wyglądających jak liczba/telefon („-1”, „+48123456789”) – arkusz nie traktuje ich jak formuły.
  const RE_GROZNY = /^[=+\-@\t\r]/;
  const RE_LICZBOWY = /^[+-]?\d[\d .,]*$/;
  function bezpieczny(s) {
    return RE_GROZNY.test(s) && !RE_LICZBOWY.test(s) ? "'" + s : s;
  }
  function poleCsv(s, sep) {
    if (s === '') return '';
    if (s.indexOf('"') >= 0 || s.indexOf(sep) >= 0 || /[\r\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // ------------------------------------------------------------------ CSV
  /**
   * CSV wg RFC 4180. Domyślnie: UTF-8 bez BOM, przecinek, CRLF (RFC 4180 wymaga CRLF; parsery – PapaParse, pandas, Excel – czytają też LF).
   * Plik dla portalu (domyślnie) zawiera dane bez zmian. Ochrona przed formułami (apostrof przed = + - @) włącza się domyślnie
   * tylko w wersji dla Excela (bom: true); można ją wymusić opcją ochrona.
   * @param {Object[]} rekordy
   * @param {{kolumny?:string[], separator?:string, koniecLinii?:string, bom?:boolean, ochrona?:boolean}} [opcje]
   */
  function csv(rekordy, opcje) {
    opcje = opcje || {};
    const kol = (opcje.kolumny || kolumny()).filter(function (k) { return k[0] !== '_'; });
    const sep = opcje.separator || ',';
    const nl = opcje.koniecLinii || '\r\n';
    const ochrona = opcje.ochrona !== undefined ? !!opcje.ochrona : !!opcje.bom;
    const linie = [kol.map(function (k) { return poleCsv(k, sep); }).join(sep)];
    (rekordy || []).forEach(function (r) {
      const w = new Array(kol.length);
      for (let i = 0; i < kol.length; i++) {
        const v = r[kol[i]];
        let s = tekstPola(kol[i], v);
        if (ochrona && typeof v === 'string') s = bezpieczny(s);
        w[i] = poleCsv(s, sep);
      }
      linie.push(w.join(sep));
    });
    return (opcje.bom ? '﻿' : '') + linie.join(nl) + nl;
  }

  // ------------------------------------------------------------ JSON i GeoJSON
  function obiekt(r) {
    const o = {};
    POLA.forEach(function (f) {
      let v = r[f.name];
      if (v === undefined) v = null;
      if (typeof v === 'number' && WSP[f.name]) v = zaokr6(v);
      o[f.name] = v;
    });
    return o;
  }
  /** Tablica obiektów z polami wzorca (typy: liczby, true/false, null dla braku). */
  function json(rekordy, opcje) {
    return JSON.stringify((rekordy || []).map(obiekt), null, opcje && opcje.wciecie !== undefined ? opcje.wciecie : 0);
  }
  /** GeoJSON (RFC 7946): FeatureCollection, geometria Point [długość, szerokość] w WGS84. Rekord bez współrzędnych: geometry null,
      chyba że opcje.tylkoZeWspolrzednymi – wtedy jest pomijany. */
  function geojson(rekordy, opcje) {
    const fc = {
      type: 'FeatureCollection',
      features: (rekordy || []).filter(function (r) {
        return !(opcje && opcje.tylkoZeWspolrzednymi) || (typeof r.szerokosc_geograficzna === 'number' && typeof r.dlugosc_geograficzna === 'number');
      }).map(function (r) {
        const ok = typeof r.szerokosc_geograficzna === 'number' && typeof r.dlugosc_geograficzna === 'number' &&
          isFinite(r.szerokosc_geograficzna) && isFinite(r.dlugosc_geograficzna);
        const f = { type: 'Feature', geometry: ok ? { type: 'Point', coordinates: [zaokr6(r.dlugosc_geograficzna), zaokr6(r.szerokosc_geograficzna)] } : null,
          properties: obiekt(r) };
        if (!pusta(r.id_aed)) f.id = r.id_aed;
        return f;
      })
    };
    return JSON.stringify(fc, null, opcje && opcje.wciecie !== undefined ? opcje.wciecie : 0);
  }

  // ------------------------------------------------------- rejestr źródeł
  const KOL_REJESTRU = ['kod_zrodla', 'nazwa_zrodla', 'dysponent', 'typ_zrodla', 'zasieg_terytorialny', 'url', 'format', 'licencja',
    'czestotliwosc_aktualizacji', 'pola_dostepne_wg_wzorca', 'glowne_braki', 'problemy_jakosci', 'priorytet_przy_konflikcie',
    'status_weryfikacji', 'liczba_rekordow', 'data_pobrania'];

  /** Licznik rekordów wg _zrodlo (rekordy scalone liczą się dla każdego źródła, z którego coś wzięto). */
  function rekordyWgZrodla(rekordy) {
    const m = new Map();
    const dodaj = function (k, r) { const t = m.get(k); if (t) t.push(r); else m.set(k, [r]); };
    (rekordy || []).forEach(function (r) {
      if (Array.isArray(r._scalonoZ) && r._scalonoZ.length) {
        const zr = new Set();
        r._scalonoZ.forEach(function (s) { zr.add(zrodloZId(s._id) || s.kodZrodla); });
        zr.forEach(function (k) { dodaj(k, r); });
      } else dodaj(r._zrodlo, r);
    });
    return m;
  }
  function zrodloZId(id) { const s = String(id || ''); const i = s.lastIndexOf(':'); return i > 0 ? s.slice(0, i) : null; }

  /**
   * Rejestr źródeł (jak arkusz „zakres_referencyjny_zrodel” wzorca) + liczba rekordów i data pobrania.
   * @param {Object[]} zrodla – AED.store.zrodla
   * @param {Object[]} [rekordy] – rekordy eksportowane (do liczby rekordów i pól dostępnych)
   * @returns {{kolumny:string[], wiersze:Object[], csv:string}}
   */
  function rejestrZrodel(zrodla, rekordy) {
    const wzor = AED.wzorzec.zrodla || [];
    const wg = rekordyWgZrodla(rekordy);
    const wymagane = POLA.filter(function (f) { return f.constraints && f.constraints.required; }).map(function (f) { return f.name; });
    const wiersze = (zrodla || []).map(function (z) {
      const meta = z.meta || {};
      const nrZbioru = meta.zbior && meta.zbior.id;
      const w = wzor.find(function (x) {
        return (nrZbioru && x.kod_zrodla === 'DGP-' + nrZbioru) || x.kod_zrodla === z.kod || (z.typ === 'FORMULARZ' && x.kod_zrodla === 'FORMULARZ');
      }) || {};
      const rek = (wg.get(z.id) || []).concat(wg.get(z.kod) && z.kod !== z.id ? wg.get(z.kod) : []);
      const dostepne = [], braki = [];
      if (rek.length) {
        POLA.forEach(function (f) {
          const ile = rek.filter(function (r) { return !pusta(r[f.name]); }).length;
          if (ile) dostepne.push(f.name);
          if (wymagane.indexOf(f.name) >= 0 && ile < rek.length / 2) braki.push(f.name);
        });
      }
      return {
        kod_zrodla: z.kod || '',
        nazwa_zrodla: z.nazwa || (meta.zbior && meta.zbior.tytul) || w.nazwa_zrodla || '',
        dysponent: z.dysponent || w.dysponent || '',
        typ_zrodla: (AED.store && AED.store.TYP_OPIS && AED.store.TYP_OPIS[z.typ]) || w.typ_zrodla || z.typ || '',
        zasieg_terytorialny: w.zasieg_terytorialny || '',
        url: (meta.zbior && meta.zbior.url) || meta.url || w.url || '',
        format: meta.format || w.format || '',
        licencja: z.licencja || '',
        czestotliwosc_aktualizacji: w.czestotliwosc_aktualizacji || '',
        pola_dostepne_wg_wzorca: dostepne.length ? dostepne.join(', ') : (w.pola_dostepne_wg_wzorca || ''),
        glowne_braki: rek.length ? braki.join(', ') : (w.glowne_braki || ''),
        problemy_jakosci: w.problemy_jakosci || (meta.ostrzezenia || []).join(' ') || '',
        priorytet_przy_konflikcie: z.priorytet === undefined || z.priorytet === null ? '' : z.priorytet,
        status_weryfikacji: w.status_weryfikacji || '',
        liczba_rekordow: rek.length,
        data_pobrania: z.dataPobrania ? String(z.dataPobrania).slice(0, 10) : ''
      };
    });
    return { kolumny: KOL_REJESTRU.slice(), wiersze: wiersze, csv: csv(wiersze, { kolumny: KOL_REJESTRU }) };
  }

  /** Tabela pochodzenia rekordów scalonych (arkusz „zrodla_rekordu” wzorca). */
  function zrodlaRekordu(rekordy, zrodla) {
    const kol = ['id_aed', 'zrodlo_danych', 'zrodlo_id_rekordu', 'licencja_rekordu', 'data_pobrania', 'rola_w_scaleniu'];
    const daty = {};
    (zrodla || (AED.store ? AED.store.zrodla : [])).forEach(function (z) { daty[z.id] = daty[z.kod] = z.dataPobrania ? String(z.dataPobrania).slice(0, 10) : ''; });
    const wiersze = [];
    (rekordy || []).forEach(function (r) {
      const lista = Array.isArray(r._scalonoZ) && r._scalonoZ.length ? r._scalonoZ :
        [{ _id: r._id, kodZrodla: r._kodZrodla, zrodloIdRekordu: r.zrodlo_id_rekordu, licencja: r.licencja_rekordu, rola: 'nadrzedne' }];
      lista.forEach(function (s) {
        wiersze.push({ id_aed: r.id_aed || '', zrodlo_danych: s.kodZrodla || '', zrodlo_id_rekordu: s.zrodloIdRekordu || '',
          licencja_rekordu: s.licencja || '', data_pobrania: daty[zrodloZId(s._id)] || daty[s.kodZrodla] || '', rola_w_scaleniu: s.rola || 'nadrzedne' });
      });
    });
    return { kolumny: kol, wiersze: wiersze, csv: csv(wiersze, { kolumny: kol }) };
  }

  // ------------------------------------------------------------------ XLSX
  /**
   * Skoroszyt XLSX (SheetJS): arkusz „dane_aed” (pola wzorca), „Źródła” (rejestr źródeł), „Pochodzenie” (gdy są rekordy scalone).
   * Wartości logiczne zapisujemy tekstem true/false (jak w CSV – bez lokalnych PRAWDA/FAŁSZ), kody (TERC, pocztowy) jako tekst.
   * @param {{zrodla?:Object[], nazwaArkusza?:string}} [opcje]
   * @returns {ArrayBuffer}
   */
  function xlsx(rekordy, opcje) {
    opcje = opcje || {};
    const X = root.XLSX;
    if (!X) throw new Error('Brak biblioteki SheetJS (XLSX) – nie można utworzyć pliku XLSX.');
    const kol = kolumny();
    const aoa = [kol];
    (rekordy || []).forEach(function (r) {
      aoa.push(kol.map(function (k) {
        const v = r[k];
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return WSP[k] ? zaokr6(v) : v;
        return tekstPola(k, v);
      }));
    });
    const wb = X.utils.book_new();
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = kol.map(function (k) { return { wch: Math.min(Math.max(k.length + 2, 10), 40) }; });
    X.utils.book_append_sheet(wb, ws, opcje.nazwaArkusza || 'dane_aed');
    const zrodla = opcje.zrodla || (AED.store ? AED.store.zrodla : []);
    const rej = rejestrZrodel(zrodla, rekordy);
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rej.wiersze, { header: rej.kolumny }), 'Źródła');
    if ((rekordy || []).some(function (r) { return r._scalonoZ; })) {
      const zr = zrodlaRekordu(rekordy, zrodla);
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(zr.wiersze, { header: zr.kolumny }), 'Pochodzenie');
    }
    return X.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  }

  // ---------------------------------------------------------------- licencja
  /**
   * Licencja zbioru wynikowego: najbardziej restrykcyjna z licencji rekordów (CC BY > CC0).
   * @param {Object[]} rekordy
   * @param {Object[]} [zrodla] – do atrybucji (nazwa, dysponent, url); domyślnie AED.store.zrodla
   * @returns {{kod:string, nazwa:string, url:string, uzasadnienie:string, atrybucje:string[], liczby:Object<string,number>}}
   */
  function licencjaZbioru(rekordy, zrodla) {
    const liczby = { 'CC0-1.0': 0, 'CC-BY-4.0': 0, brak: 0 };
    const zrodlaLic = {}; // kod źródła -> licencja (z rekordów)
    (rekordy || []).forEach(function (r) {
      const l = LICENCJE[r.licencja_rekordu] ? r.licencja_rekordu : 'brak';
      liczby[l]++;
      const czlonkowie = Array.isArray(r._scalonoZ) ? r._scalonoZ.filter(function (s) { return !Array.isArray(s.wklad) || s.wklad.length > 0; }) : [{ kodZrodla: r._kodZrodla, licencja: r.licencja_rekordu, _id: r._id }];
      czlonkowie.forEach(function (s) {
        const lic = s.licencja || r.licencja_rekordu;
        if (s.kodZrodla && lic) zrodlaLic[s.kodZrodla] = lic;
      });
    });
    const n = (rekordy || []).length;
    let kod = 'CC0-1.0';
    if (liczby['CC-BY-4.0']) kod = 'CC-BY-4.0';
    const zr = zrodla || (AED.store ? AED.store.zrodla : []);
    const atrybucje = [];
    Object.keys(zrodlaLic).sort().forEach(function (k) {
      if (zrodlaLic[k] !== 'CC-BY-4.0') return;
      const z = zr.find(function (x) { return x.kod === k; }) || {};
      const meta = z.meta || {};
      const url = (meta.zbior && meta.zbior.url) || meta.url || '';
      atrybucje.push((z.dysponent || 'Dysponent') + ' – „' + (z.nazwa || k) + '”' + (url ? ' (' + url + ')' : '') + ', licencja CC BY 4.0');
    });
    let uz;
    if (kod === 'CC-BY-4.0') {
      uz = liczby['CC-BY-4.0'] + ' z ' + n + ' rekordów ma licencję CC BY 4.0 – zbiór musi zachować uznanie autorstwa tych źródeł (lista atrybucji poniżej).';
    } else {
      uz = 'Wszystkie rekordy z określoną licencją są na CC0 1.0 – zbiór można udostępnić jako domenę publiczną.';
    }
    if (liczby.brak) uz += ' ' + liczby.brak + ' rekordów nie ma licencji – uzupełnij pole „licencja_rekordu” przed publikacją.';
    return { kod: kod, nazwa: LICENCJE[kod].nazwa, url: LICENCJE[kod].url, licencjaXml: LICENCJE[kod].xml, uzasadnienie: uz, atrybucje: atrybucje, liczby: liczby };
  }

  // ---------------------------------------------------------- Data Package
  function schematFrictionless() {
    const s = JSON.parse(JSON.stringify(SCHEMA));
    s.fields.forEach(function (f) { delete f.aed; });
    return s;
  }
  function schematRejestru() {
    return { fields: KOL_REJESTRU.map(function (k) {
      return { name: k, type: k === 'liczba_rekordow' ? 'integer' : k === 'data_pobrania' ? 'date' : 'string' };
    }), missingValues: [''] };
  }
  function nazwaPakietu(t) {
    return (AED.normalizacja ? AED.normalizacja.klucz(t) : String(t).toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'aed';
  }
  const MEDIA = { csv: 'text/csv', json: 'application/json', geojson: 'application/geo+json',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xml: 'application/xml' };

  /**
   * Frictionless Data Package (datapackage.json) z dołączonym schematem tabeli.
   * @param {Object} metadane – jak dla metadaneXml (tytul, opis, slowaKluczowe, …) + opcjonalnie licencja: {kod} z licencjaZbioru
   * @param {{nazwa?:string, plik:string, format?:string, tytul?:string, opis?:string, kod?:string, schemat?:'aed'|'rejestr'}[]} [zasoby]
   *        domyślnie CSV + GeoJSON; zasób z kod 'rejestr' (albo schemat 'rejestr') dostaje schemat rejestru źródeł
   */
  function datapackage(metadane, zasoby) {
    metadane = metadane || {};
    const lic = metadane.licencja && metadane.licencja.kod ? metadane.licencja : null;
    const data = dataIso(metadane.data);
    if (!zasoby || !zasoby.length) {
      zasoby = [{ plik: nazwaPliku('csv', data), format: 'csv', tytul: 'Defibrylatory AED – CSV' },
        { plik: nazwaPliku('geojson', data), format: 'geojson', tytul: 'Defibrylatory AED – GeoJSON' }];
    }
    const formaty = zasoby.map(function (z) { return (z.format || String(z.plik || '').split('.').pop() || 'csv').toLowerCase(); });
    const pakiet = {
      // tabular-data-package wymaga, by każdy zasób był tabelą (CSV ze schematem)
      profile: formaty.every(function (f) { return f === 'csv'; }) ? 'tabular-data-package' : 'data-package',
      name: nazwaPakietu(metadane.nazwa || metadane.extIdent || metadane.tytul || 'aed'),
      title: metadane.tytul || 'Defibrylatory AED',
      description: metadane.opis || '',
      version: SCHEMA.version,
      created: dataCzasIso(new Date()),
      keywords: (metadane.slowaKluczowe || []).slice(),
      licenses: lic ? [{ name: lic.kod, title: LICENCJE[lic.kod] ? LICENCJE[lic.kod].nazwa : lic.kod, path: LICENCJE[lic.kod] ? LICENCJE[lic.kod].url : '' }] : [],
      sources: (metadane.zrodla || []).map(function (z) { return { title: z.nazwa || z.kod, path: (z.meta && ((z.meta.zbior && z.meta.zbior.url) || z.meta.url)) || '' }; }),
      resources: zasoby.map(function (z, i) {
        const format = formaty[i];
        const baza = nazwaPakietu(z.nazwa || String(z.plik || 'zasob-' + (i + 1)).replace(/\.[^.]+$/, ''));
        const res = {
          name: format === 'csv' || new RegExp('-' + format + '$').test(baza) ? baza : baza + '-' + format,
          path: z.plik, title: z.tytul || z.plik, description: z.opis || '', format: format, mediatype: MEDIA[format] || 'application/octet-stream'
        };
        if (format === 'csv') {
          res.profile = 'tabular-data-resource';
          res.encoding = 'utf-8';
          res.dialect = { delimiter: ',', lineTerminator: '\r\n', quoteChar: '"', doubleQuote: true, header: true };
          // rejestr źródeł ma własne kolumny – nie dostaje schematu AED
          res.schema = (z.kod === 'rejestr' || z.schemat === 'rejestr') ? schematRejestru() : schematFrictionless();
        } else if (format === 'json' || format === 'geojson') res.encoding = 'utf-8';
        if (z.licencja) res.licenses = [{ name: z.licencja }];
        return res;
      })
    };
    if (!pakiet.licenses.length) delete pakiet.licenses;
    if (!pakiet.sources.length) delete pakiet.sources;
    if (metadane.url) pakiet.homepage = metadane.url;
    return JSON.stringify(pakiet, null, 2);
  }

  // ------------------------------------------------------------ metadane XML
  /* Struktura Metadane (wszystkie teksty po polsku, *En – opcjonalne tłumaczenia):
     { extIdent, tytul, tytulEn?, opis, opisEn?, url?, czestotliwosc ('daily'…'notPlanned'), kategorie: ['HEAL',…],
       slowaKluczowe: [..], slowaKluczoweEn?: [..], status?: 'published'|'draft', dataAktualizacji?: Date|'RRRR-MM-DDThh:mm:ss',
       daneDynamiczne?, daneWysokiejWartosci?, daneWysokiejWartosciKE?, daneBadawcze?: boolean,
       warunki?: { zrodlo?: bool, modyfikacja?: bool, odpowiedzialnosc?: string, bazaDanych?: string, licencja?: 'CC0 1.0'|…, daneOsobowe?: string },
       dokumenty?: [{ url (https), nazwa, nazwaEn?, jezyk: 'pl'|'en' }] }
     Zasób: { extIdent, url (https), tytul, tytulEn?, opis, opisEn?, dostepnosc?: 'local'|'remote', dataDanych?: 'RRRR-MM-DD',
       dataAktualizacji?, daneDynamiczne?, daneWysokiejWartosci?, daneWysokiejWartosciKE?, daneBadawcze?, daneChronione?: boolean,
       regiony?: ['1465011', …] (TERYT 2–7 znaków, maks. 20), status? } */
  const RE_ZLE_ZNAKI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
  function esc(t) {
    return String(t === null || t === undefined ? '' : t).replace(RE_ZLE_ZNAKI, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function dt(v) {
    if (jestData(v)) return dataCzasIso(v);
    const s = String(v || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00';
    return s;
  }
  function el(nazwa, wartosc, wc) { return wc + '<' + nazwa + '>' + esc(wartosc) + '</' + nazwa + '>'; }
  function bool(nazwa, v, wc) { return v === undefined || v === null ? '' : el(nazwa, v ? 'true' : 'false', wc) + '\n'; }
  function dwujezyczny(nazwa, pl, en, wc) {
    let s = wc + '<' + nazwa + '>\n' + el('polish', pl, wc + '  ') + '\n';
    if (!pusta(en)) s += el('english', en, wc + '  ') + '\n';
    return s + wc + '</' + nazwa + '>\n';
  }
  function dokumenty(lista, wc) {
    if (!lista || !lista.length) return '';
    let s = wc + '<supplements>\n';
    lista.slice(0, 10).forEach(function (d) {
      s += wc + '  <supplement>\n' + el('url', d.url, wc + '    ') + '\n' + dwujezyczny('name', d.nazwa, d.nazwaEn, wc + '    ') +
        el('language', d.jezyk || 'pl', wc + '    ') + '\n' + wc + '  </supplement>\n';
    });
    return s + wc + '</supplements>\n';
  }
  function zasobXml(z, wc) {
    let s = wc + '<resource status="' + esc(z.status || 'published') + '">\n';
    const w = wc + '  ';
    s += el('extIdent', z.extIdent, w) + '\n' + el('url', z.url, w) + '\n';
    s += dwujezyczny('title', z.tytul, z.tytulEn, w) + dwujezyczny('description', z.opis, z.opisEn, w);
    if (z.dostepnosc) s += el('availability', z.dostepnosc, w) + '\n';
    if (z.dataDanych) s += el('dataDate', dataIso(z.dataDanych), w) + '\n';
    if (z.dataAktualizacji) s += el('lastUpdateDate', dt(z.dataAktualizacji), w) + '\n';
    s += bool('hasDynamicData', z.daneDynamiczne, w) + bool('hasHighValueData', z.daneWysokiejWartosci, w) +
      bool('hasHighValueDataFromEuropeanCommissionList', z.daneWysokiejWartosciKE, w) + bool('hasResearchData', z.daneBadawcze, w) +
      bool('containsProtectedData', z.daneChronione, w);
    s += dokumenty(z.dokumenty, w);
    if (z.regiony && z.regiony.length) {
      s += w + '<regions>\n' + z.regiony.slice(0, 20).map(function (r) { return el('terytIdent', r, w + '  '); }).join('\n') + '\n' + w + '</regions>\n';
    }
    return s + wc + '</resource>\n';
  }
  /**
   * Plik XML dla harvestera dane.gov.pl (schemat otwarte_dane_latest.xsd, przestrzeń urn:otwarte-dane:harvester:1.13).
   * Element główny w przestrzeni nazw, elementy podrzędne bez przestrzeni (elementFormDefault="unqualified").
   */
  function metadaneXml(metadane, zasoby) {
    const m = metadane || {};
    zasoby = zasoby || m.zasoby || [];
    const w = '    ';
    let s = '<?xml version="1.0" encoding="UTF-8"?>\n<ns2:datasets xmlns:ns2="urn:otwarte-dane:harvester:1.13">\n';
    s += '  <dataset status="' + esc(m.status || 'published') + '">\n';
    s += el('extIdent', m.extIdent, w) + '\n';
    s += dwujezyczny('title', m.tytul, m.tytulEn, w) + dwujezyczny('description', m.opis, m.opisEn, w);
    if (!pusta(m.url)) s += el('url', m.url, w) + '\n';
    s += el('updateFrequency', m.czestotliwosc || 'irregular', w) + '\n';
    s += w + '<categories>\n' + (m.kategorie || []).map(function (k) { return el('category', k, w + '  '); }).join('\n') + '\n' + w + '</categories>\n';
    const wa = m.warunki;
    if (wa) {
      let c = '';
      c += bool('source', wa.zrodlo, w + '  ') + bool('modification', wa.modyfikacja, w + '  ');
      if (!pusta(wa.odpowiedzialnosc)) c += el('responsibilities', wa.odpowiedzialnosc, w + '  ') + '\n';
      if (!pusta(wa.bazaDanych)) c += el('dbOrCopyrighted', wa.bazaDanych, w + '  ') + '\n';
      if (!pusta(wa.licencja)) c += el('dbOrCopyrightedLicenseChosen', wa.licencja, w + '  ') + '\n';
      if (!pusta(wa.daneOsobowe)) c += el('personalData', wa.daneOsobowe, w + '  ') + '\n';
      s += w + '<conditions>\n' + c + w + '</conditions>\n';
    }
    s += w + '<resources>\n' + zasoby.map(function (z) { return zasobXml(z, w + '  '); }).join('') + w + '</resources>\n';
    const tagi = (m.slowaKluczowe || []).map(function (t) { return w + '  <tag lang="pl">' + esc(t) + '</tag>'; })
      .concat((m.slowaKluczoweEn || []).map(function (t) { return w + '  <tag lang="en">' + esc(t) + '</tag>'; }));
    s += w + '<tags>\n' + tagi.join('\n') + '\n' + w + '</tags>\n';
    if (m.dataAktualizacji) s += el('lastUpdateDate', dt(m.dataAktualizacji), w) + '\n';
    s += bool('hasDynamicData', m.daneDynamiczne, w) + bool('hasHighValueData', m.daneWysokiejWartosci, w) +
      bool('hasHighValueDataFromEuropeanCommissionList', m.daneWysokiejWartosciKE, w) + bool('hasResearchData', m.daneBadawcze, w);
    s += dokumenty(m.dokumenty, w);
    s += '  </dataset>\n</ns2:datasets>\n';
    return s;
  }

  /**
   * Sprawdzenie metadanych przed eksportem XML (reguły z otwarte_dane_latest.xsd + zalecenia wzorca).
   * @returns {{pole:string, poziom:'blad'|'ostrzezenie', kod:string, komunikat:string}[]}
   */
  function walidujMetadane(metadane, zasoby) {
    const m = metadane || {};
    zasoby = zasoby || m.zasoby;
    const p = [];
    const dodaj = function (pole, poziom, kod, komunikat) { p.push({ pole: pole, poziom: poziom, kod: kod, komunikat: komunikat }); };
    const tekst = function (pole, v, nazwa, min, max, wymagane) {
      if (pusta(v)) { if (wymagane) dodaj(pole, 'blad', 'WYMAGANE', 'Uzupełnij pole „' + nazwa + '”.'); return; }
      if (typeof v !== 'string') { dodaj(pole, 'blad', 'TYP', 'Pole „' + nazwa + '” musi być tekstem.'); return; }
      if (v.length < min || v.length > max) dodaj(pole, 'blad', 'DLUGOSC', 'Pole „' + nazwa + '” ma ' + v.length + ' znaków – dozwolone ' + min + '–' + max + '.');
    };
    const https = function (pole, v, nazwa, max, wymagane) {
      if (pusta(v)) { if (wymagane) dodaj(pole, 'blad', 'WYMAGANE', 'Podaj adres „' + nazwa + '” (https://…).'); return; }
      if (!/^https:\/\/\S+$/.test(v)) dodaj(pole, 'blad', 'WZORZEC', 'Adres „' + nazwa + '” musi zaczynać się od https:// i nie może zawierać spacji.');
      else if (v.length > max) dodaj(pole, 'blad', 'DLUGOSC', 'Adres „' + nazwa + '” jest za długi (maks. ' + max + ' znaków).');
    };
    const bools = function (obj, przedrostek) {
      ['daneDynamiczne', 'daneWysokiejWartosci', 'daneWysokiejWartosciKE', 'daneBadawcze', 'daneChronione'].forEach(function (k) {
        if (obj[k] !== undefined && obj[k] !== null && typeof obj[k] !== 'boolean') dodaj(przedrostek + k, 'blad', 'TYP', 'Pole „' + k + '” przyjmuje tylko tak/nie.');
      });
    };
    tekst('extIdent', m.extIdent, 'Identyfikator zbioru (extIdent)', 1, 36, true);
    tekst('tytul', m.tytul, 'Tytuł', 1, 300, true);
    tekst('tytulEn', m.tytulEn, 'Tytuł po angielsku', 1, 300, false);
    tekst('opis', m.opis, 'Opis', 1, 1000, true);
    tekst('opisEn', m.opisEn, 'Opis po angielsku', 1, 1000, false);
    if (!pusta(m.url)) {
      if (!/^[a-z][a-z0-9+.-]*:\S+$/i.test(m.url)) dodaj('url', 'blad', 'WZORZEC', 'Adres zbioru musi być pełnym adresem URL (np. https://…), bez spacji.');
      else if (m.url.length > 1000) dodaj('url', 'blad', 'DLUGOSC', 'Adres zbioru jest za długi (maks. 1000 znaków).');
    }
    if (KODY_XML.czestotliwosc.indexOf(m.czestotliwosc || 'irregular') < 0) {
      dodaj('czestotliwosc', 'blad', 'SLOWNIK', 'Nieznana częstotliwość „' + m.czestotliwosc + '”. Wybierz z listy.');
    }
    const kat = m.kategorie || [];
    if (!kat.length) dodaj('kategorie', 'blad', 'WYMAGANE', 'Wybierz co najmniej jedną kategorię (dla AED: Zdrowie – HEAL).');
    kat.forEach(function (k) { if (KODY_XML.kategorie.indexOf(k) < 0) dodaj('kategorie', 'blad', 'SLOWNIK', 'Nieznana kategoria „' + k + '”.'); });
    const tagi = (m.slowaKluczowe || []).filter(function (t) { return !pusta(t); });
    if (!tagi.length) dodaj('slowaKluczowe', 'blad', 'WYMAGANE', 'Podaj co najmniej jedno słowo kluczowe.');
    if (tagi.length && tagi.map(function (t) { return t.toLowerCase(); }).indexOf('wzorzec-aed') < 0) {
      dodaj('slowaKluczowe', 'ostrzezenie', 'ZALECANE', 'Dodaj słowo kluczowe „wzorzec-aed” – pozwala znaleźć przez API wszystkie zbiory AED zgodne ze wzorcem.');
    }
    if ((m.slowaKluczowe || []).some(pusta)) dodaj('slowaKluczowe', 'blad', 'WYMAGANE', 'Usuń puste słowa kluczowe.');
    if (m.status && KODY_XML.status.indexOf(m.status) < 0) dodaj('status', 'blad', 'SLOWNIK', 'Status musi być „published” albo „draft”.');
    if (m.dataAktualizacji && !(jestData(m.dataAktualizacji)) && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/.test(m.dataAktualizacji)) {
      dodaj('dataAktualizacji', 'blad', 'WZORZEC', 'Data aktualizacji musi mieć format RRRR-MM-DDThh:mm:ss.');
    }
    bools(m, '');
    const wa = m.warunki || {};
    ['odpowiedzialnosc', 'bazaDanych', 'daneOsobowe'].forEach(function (k) { tekst('warunki.' + k, wa[k], k, 0, 4000, false); });
    // harvester dane.gov.pl (mcod/harvester/serializers.py): oba pola warunku z art. 13 ust. 2 ustawy o ponownym
    // wykorzystywaniu ISP muszą wystąpić razem – sam wybór licencji bez treści warunku (albo odwrotnie) jest odrzucany
    if (pusta(wa.bazaDanych) !== pusta(wa.licencja)) {
      dodaj(pusta(wa.bazaDanych) ? 'warunki.bazaDanych' : 'warunki.licencja', 'blad', 'NIESPOJNY',
        'Portal dane.gov.pl wymaga obu elementów warunku dla bazy danych: treści warunku (dbOrCopyrighted) i wybranej licencji (dbOrCopyrightedLicenseChosen).');
    }
    if (!pusta(wa.licencja) && KODY_XML.licencje.indexOf(wa.licencja) < 0) {
      dodaj('warunki.licencja', 'blad', 'SLOWNIK', 'Licencja „' + wa.licencja + '” nie występuje na liście dane.gov.pl.');
    }
    if (m.licencja && m.licencja.licencjaXml && !pusta(wa.licencja) && wa.licencja !== m.licencja.licencjaXml) {
      dodaj('warunki.licencja', 'ostrzezenie', 'LICENCJA', 'Wybrana licencja „' + wa.licencja + '” różni się od wynikającej z rekordów („' + m.licencja.licencjaXml + '”).');
    }
    if (pusta(m.opisEn) || pusta(m.tytulEn)) dodaj('tytulEn', 'ostrzezenie', 'ZALECANE', 'Warto podać tytuł i opis po angielsku – zbiór będzie widoczny w Europejskim Portalu Danych.');
    const dok = m.dokumenty || [];
    if (dok.length > 10) dodaj('dokumenty', 'blad', 'DLUGOSC', 'Można dołączyć najwyżej 10 dokumentów uzupełniających.');
    dok.forEach(function (d, i) {
      https('dokumenty.' + i + '.url', d.url, 'dokument ' + (i + 1), 2000, true);
      tekst('dokumenty.' + i + '.nazwa', d.nazwa, 'nazwa dokumentu ' + (i + 1), 1, 300, true);
      if (KODY_XML.jezyki.indexOf(d.jezyk || 'pl') < 0) dodaj('dokumenty.' + i + '.jezyk', 'blad', 'SLOWNIK', 'Język dokumentu: pl albo en.');
    });
    if (zasoby !== undefined) {
      if (!zasoby || !zasoby.length) dodaj('zasoby', 'blad', 'WYMAGANE', 'Zbiór musi mieć co najmniej jeden zasób (plik z danymi).');
      const idy = {};
      (zasoby || []).forEach(function (z, i) {
        const pr = 'zasoby.' + i + '.';
        tekst(pr + 'extIdent', z.extIdent, 'identyfikator zasobu ' + (i + 1), 1, 36, true);
        if (z.extIdent && idy[z.extIdent]) dodaj(pr + 'extIdent', 'blad', 'UNIKALNY', 'Identyfikator zasobu „' + z.extIdent + '” się powtarza.');
        idy[z.extIdent] = 1;
        https(pr + 'url', z.url, 'zasobu ' + (i + 1), 2000, true);
        tekst(pr + 'tytul', z.tytul, 'tytuł zasobu ' + (i + 1), 1, 300, true);
        tekst(pr + 'opis', z.opis, 'opis zasobu ' + (i + 1), 1, 1000, true);
        if (z.dostepnosc && KODY_XML.dostepnosc.indexOf(z.dostepnosc) < 0) dodaj(pr + 'dostepnosc', 'blad', 'SLOWNIK', 'Dostępność zasobu: local albo remote.');
        if (z.dataDanych && !/^\d{4}-\d{2}-\d{2}$/.test(dataIso(z.dataDanych))) dodaj(pr + 'dataDanych', 'blad', 'WZORZEC', 'Data danych w formacie RRRR-MM-DD.');
        (z.regiony || []).forEach(function (r) {
          if (!/^\d{2,7}$/.test(String(r))) dodaj(pr + 'regiony', 'blad', 'WZORZEC', 'Kod TERYT regionu „' + r + '” musi mieć od 2 do 7 cyfr.');
        });
        if ((z.regiony || []).length > 20) dodaj(pr + 'regiony', 'blad', 'DLUGOSC', 'Najwyżej 20 regionów na zasób.');
        bools(z, pr);
      });
    }
    return p;
  }

  /** Kody TERYT do elementu <regions>: gminy (7 cyfr), a gdy jest ich więcej niż 20 – województwa (2 cyfry). */
  function regiony(rekordy) {
    const gm = new Set(), woj = new Set();
    (rekordy || []).forEach(function (r) {
      if (typeof r.kod_terc_gminy === 'string' && /^\d{7}$/.test(r.kod_terc_gminy)) { gm.add(r.kod_terc_gminy); woj.add(r.kod_terc_gminy.slice(0, 2)); }
      else if (r.wojewodztwo && AED.normalizacja) { const k = AED.normalizacja.kodWojewodztwa(r.wojewodztwo); if (k) woj.add(k); }
    });
    if (gm.size && gm.size <= 20 && woj.size <= 1) return Array.from(gm).sort();
    return woj.size <= 20 ? Array.from(woj).sort() : [];
  }

  /** 'aed_2026-11-21.csv'; opcjonalnie z kodem TERC gminy: 'aed_1861011_2026-11-21.csv' (konwencja z arkusza metadane_zbioru). */
  function nazwaPliku(rozszerzenie, data, opcje) {
    const roz = String(rozszerzenie || 'csv').replace(/^\./, '').toLowerCase();
    const terc = opcje && opcje.terc && /^\d{7}$/.test(opcje.terc) ? opcje.terc + '_' : '';
    const przed = (opcje && opcje.przedrostek) || 'aed';
    return przed + '_' + terc + dataIso(data) + '.' + roz;
  }

  /** Treść warunku dbOrCopyrighted (art. 13 ust. 2 ustawy o ponownym wykorzystywaniu ISP) dla wybranej licencji zbioru. */
  function warunekBazyDanych(licencjaXml) {
    return 'Zbiór danych o defibrylatorach AED stanowi bazę danych. Można go ponownie wykorzystywać na warunkach licencji ' + licencjaXml + '.';
  }

  AED.eksport = {
    warunekBazyDanych: warunekBazyDanych,
    SLOWNIKI_XML: SLOWNIKI_XML,
    LICENCJE: LICENCJE,
    kolumny: kolumny,
    csv: csv,
    json: json,
    geojson: geojson,
    xlsx: xlsx,
    rejestrZrodel: rejestrZrodel,
    zrodlaRekordu: zrodlaRekordu,
    datapackage: datapackage,
    licencjaZbioru: licencjaZbioru,
    metadaneXml: metadaneXml,
    walidujMetadane: walidujMetadane,
    regiony: regiony,
    nazwaPliku: nazwaPliku
  };
})(window.AED);
