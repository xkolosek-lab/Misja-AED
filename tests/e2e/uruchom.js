/* Testy end-to-end w headless Edge/Chrome (bez zależności npm).
   Uruchomienie z katalogu repozytorium:  node tests/e2e/uruchom.js [nazwa-testu ...] [--siec] [--zrzuty]
   - sam uruchamia `python serwer.py --port <wolny> --baza <plik tymczasowy>` (aplikacja + API bazy wyniki.gov; gdy brak
     serwer.py – `python -m http.server`) i zamyka go na końcu; tymczasowa baza jest usuwana,
   - bez --siec testy nie łączą się z internetem (kafle mapy GUGiK zastępuje lokalny obrazek, geokoder – atrapa),
   - --zrzuty zapisuje zrzuty ekranu w katalogu tymczasowym (ścieżka w wyniku).
   Kod wyjścia 0 = wszystkie sprawdzenia zaliczone. Wymaga Node 22+ i przeglądarki Edge lub Chrome. */
'use strict';
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { uruchom } = require('./cdp');

const KORZEN = path.resolve(__dirname, '..', '..');
const TESTY = ['podstawy', 'przeplyw', 'formularz', 'gov', 'dostepnosc'];

function wolnyPort() {
  return new Promise(function (ok, nie) {
    const s = net.createServer();
    s.once('error', nie);
    s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { ok(p); }); });
  });
}

/** Czy serwer odpowiada (http.get zamiast fetch – serwer Pythona zamyka połączenie po odpowiedzi HTTP/1.0). */
function odpowiada(port) {
  return new Promise(function (ok) {
    const r = http.get({ host: '127.0.0.1', port: port, path: '/index.html' }, function (res) { res.resume(); ok(res.statusCode === 200); });
    r.on('error', function () { ok(false); });
    r.setTimeout(1000, function () { r.destroy(); ok(false); });
  });
}

/** serwer.py (z API bazy wyniki.gov w pliku tymczasowym), a gdy go nie ma – statyczny http.server. */
async function startSerwera(port, plikBazy) {
  const kandydaci = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  const zApi = fs.existsSync(path.join(KORZEN, 'serwer.py'));
  for (const cmd of kandydaci) {
    const args = (cmd === 'py' ? ['-3'] : []).concat(zApi
      ? ['serwer.py', '--port', String(port), '--host', '127.0.0.1', '--baza', plikBazy]
      : ['-m', 'http.server', String(port), '--bind', '127.0.0.1']);
    const p = spawn(cmd, args, { cwd: KORZEN, stdio: 'ignore' });
    let blad = null;
    p.on('error', function (e) { blad = e; });
    for (let i = 0; i < 60 && !blad && p.exitCode === null; i++) {
      if (await odpowiada(port)) return p;
      await new Promise(function (r) { setTimeout(r, 150); });
    }
    try { p.kill(); } catch (e) { /* nie wystartował */ }
  }
  throw new Error('Nie udało się uruchomić ' + (zApi ? '`python serwer.py`' : '`python -m http.server`') + ' (wymagany Python 3 w PATH).');
}
/** Czy serwer ma API bazy (GET /api/status). */
function maApi(port) {
  return new Promise(function (ok) {
    const r = http.get({ host: '127.0.0.1', port: port, path: '/api/status' }, function (res) {
      let d = ''; res.on('data', function (c) { d += c; });
      res.on('end', function () { try { ok(res.statusCode === 200 && JSON.parse(d).tryb === 'serwer'); } catch (e) { ok(false); } });
    });
    r.on('error', function () { ok(false); });
    r.setTimeout(1500, function () { r.destroy(); ok(false); });
  });
}

(async function () {
  const argumenty = process.argv.slice(2);
  const wybrane = argumenty.filter(function (a) { return !a.startsWith('--'); });
  const doUruchomienia = wybrane.length ? TESTY.filter(function (t) { return wybrane.indexOf(t) >= 0; }) : TESTY;
  const opcje = { siec: argumenty.indexOf('--siec') >= 0, zrzuty: argumenty.indexOf('--zrzuty') >= 0 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aed-e2e-'));
  const portHttp = await wolnyPort();
  const plikBazy = path.join(tmp, 'wyniki-test.gov');
  const serwer = await startSerwera(portHttp, plikBazy);
  const adres = 'http://127.0.0.1:' + portHttp + '/';
  const api = await maApi(portHttp);
  let b = null;
  let zaliczone = 0, niezaliczone = 0;
  const sprzatanie = function () { try { serwer.kill(); } catch (e) { /* już zamknięty */ } };
  process.on('exit', sprzatanie);
  process.on('SIGINT', function () { sprzatanie(); process.exit(130); });
  // bezpiecznik: zawieszony test nie zostawia działającej przeglądarki ani serwera
  const bezpiecznik = setTimeout(async function () {
    console.log('BŁĄD: przekroczono łączny czas testów (10 min).');
    if (b) await b.zamknij();
    sprzatanie(); process.exit(1);
  }, 10 * 60 * 1000);
  bezpiecznik.unref();

  try {
    b = await uruchom({ portDebug: await wolnyPort(), adres: adres, siec: opcje.siec });
    console.log('Serwer: ' + adres + (api ? ' – serwer.py z API, baza ' + plikBazy : ' – serwer statyczny (bez API bazy)') +
      (opcje.siec ? ' (z dostępem do sieci)' : ' (bez dostępu do sieci)'));
    for (const nazwa of doUruchomienia) {
      console.log('\n== ' + nazwa);
      const bledyPrzed = b.bledy.length;
      const t = {
        b: b, adres: adres, korzen: KORZEN, opcje: opcje, api: api, plikBazy: plikBazy,
        pobrane: path.join(tmp, 'pobrane-' + nazwa),
        zrzut: async function (n) { if (opcje.zrzuty) await b.zrzut(path.join(tmp, nazwa + '-' + n + '.png')); },
        ok: function (warunek, opis, dodatkowo) {
          if (warunek) zaliczone++; else niezaliczone++;
          console.log((warunek ? '  ok    ' : '  BŁĄD  ') + opis + (dodatkowo !== undefined && !warunek ? ' -> ' + JSON.stringify(dodatkowo) : ''));
        }
      };
      try {
        await b.szerokosc(1280);
        await b.idz(adres + 'index.html#start');
        await b.ocen('try { localStorage.clear(); } catch (e) {} true');
        await require('./' + nazwa + '.js')(t);
      } catch (e) {
        t.ok(false, 'wyjątek w teście: ' + (e && e.stack || e));
      }
      const nowe = b.bledy.slice(bledyPrzed);
      t.ok(!nowe.length, 'brak błędów w konsoli przeglądarki', nowe.slice(0, 10));
    }
    if (!opcje.siec) {
      const t = b.zewnetrzne.filter(function (u) { return !/^https:\/\/mapy\.geoportal\.gov\.pl\//.test(u); });
      if (t.length) { niezaliczone++; console.log('  BŁĄD  nieoczekiwane żądania do internetu: ' + JSON.stringify(t.slice(0, 10))); } else zaliczone++;
    }
  } catch (e) {
    niezaliczone++;
    console.log('BŁĄD: ' + (e && e.stack || e));
  } finally {
    if (b) await b.zamknij();
    sprzatanie();
  }
  console.log('\nWynik: ' + zaliczone + ' zaliczonych, ' + niezaliczone + ' niezaliczonych.' + (opcje.zrzuty ? ' Zrzuty: ' + tmp : ''));
  if (!opcje.zrzuty) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* zostanie w katalogu tymczasowym */ } }
  process.exit(niezaliczone ? 1 : 0);
})();
