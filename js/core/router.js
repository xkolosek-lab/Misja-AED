/* Router oparty na #hash. Każdy ekran to <section data-route="...">.
   Po zmianie ekranu: aktualizacja tytułu strony, aria-current w nawigacji
   i przeniesienie fokusu na nagłówek H1 (WCAG 2.4.3, 2.4.2). */
(function (AED) {
  'use strict';

  const KROKI = ['zrodla', 'mapowanie', 'walidacja', 'wynik'];
  const NAZWA_SERWISU = 'Namiar na Puls';
  let pierwszeWejscie = true;
  let ostatnia = 'start';

  function biezacaTrasa() {
    const t = (location.hash || '#start').slice(1);
    if (document.querySelector('section[data-route="' + CSS.escape(t) + '"]')) return t;
    // Kotwica do elementu na stronie (np. link „Przejdź do treści”) – nie zmieniamy ekranu
    if (t && document.getElementById(t)) return null;
    return '404';
  }

  function pokaz() {
    const trasa = biezacaTrasa();
    if (trasa === null) return;
    ostatnia = trasa;
    let h1 = null;

    document.querySelectorAll('main > section[data-route]').forEach(function (s) {
      const aktywna = s.dataset.route === trasa;
      s.hidden = !aktywna;
      if (aktywna) h1 = s.querySelector('h1');
    });

    // Pasek kroków tylko na ścieżce koordynatora
    const idx = KROKI.indexOf(trasa);
    const stepper = document.getElementById('stepper');
    stepper.hidden = idx < 0;
    stepper.querySelectorAll('a[data-step]').forEach(function (a, i) {
      if (i === idx) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
    });
    if (idx >= 0) {
      const kompakt = document.getElementById('stepper-compact');
      kompakt.textContent = '';
      kompakt.append('Krok ' + (idx + 1) + ' z ' + KROKI.length + ': ' +
        stepper.querySelector('a[data-step="' + KROKI[idx] + '"]').textContent.replace(/^\s*\d\s*/, '').trim());
      const pr = document.createElement('progress');
      pr.max = KROKI.length; pr.value = idx + 1;
      pr.setAttribute('aria-hidden', 'true');
      kompakt.appendChild(pr);
    }

    // Menu główne: zaznacz bieżącą sekcję
    document.querySelectorAll('.top-nav a').forEach(function (a) {
      const cel = a.getAttribute('href').slice(1);
      const biezaca = cel === trasa || (cel === 'zrodla' && idx >= 0);
      if (biezaca) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });

    // WCAG 2.4.2: tytuł opisuje bieżący ekran; na stronie startowej sama nazwa serwisu
    document.title = (trasa !== 'start' && h1 ? h1.textContent.trim().replace(/\s+/g, ' ') + ' – ' : '') + NAZWA_SERWISU;

    // Przy pierwszym wczytaniu nie przejmujemy fokusu (użytkownik zaczyna od początku strony)
    if (!pierwszeWejscie && h1) {
      h1.focus({ preventScroll: false });
      window.scrollTo(0, 0);
    }
    pierwszeWejscie = false;
    AED.emit('trasa', { trasa: trasa, krok: idx + 1 });
  }

  AED.router = {
    KROKI: KROKI,
    start: function () {
      window.addEventListener('hashchange', pokaz);
      pokaz();
    },
    idz: function (trasa) {
      if (location.hash === '#' + trasa) pokaz(); else location.hash = trasa;
    },
    get trasa() { return ostatnia; }
  };
})(window.AED);
