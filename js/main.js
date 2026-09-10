/**
 * Scenic Mountain Roofing — site behavior
 * Navigation, scroll-spy, FAQ, reveals, sticky action bar, form validation.
 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // initNav publishes the drawer state here; initActionBar reads it so the bar
  // never floats above the modal scrim.
  var navIsOpen = false;
  var onNavToggle = function () {};

  /* ── Header height ────────────────────── */
  /* The header wraps to two rows between 641px and 1080px so all eight nav
     links, the phone number and the CTA stay visible. Its height is therefore
     variable, and scroll-padding-top plus the drawer's top inset both depend
     on the real value. */
  function initHeaderMetrics() {
    var header = document.querySelector('.header');
    if (!header) return;

    function measure() {
      document.documentElement.style.setProperty('--header-real', header.offsetHeight + 'px');
    }

    measure();

    var timer;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(measure, 120);
    }, { passive: true });

    // The nav row's wrapping depends on the webfont, so re-measure once it lands
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  }

  /* ── Sticky header shadow ─────────────── */
  function initHeaderState() {
    var header = document.querySelector('.header');
    if (!header) return;

    var ticking = false;
    function update() {
      header.classList.toggle('is-stuck', window.scrollY > 8);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* ── Mobile navigation ────────────────── */
  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.nav');
    var scrim = document.querySelector('.nav-scrim');
    if (!toggle || !nav || !scrim) return;

    var lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      navIsOpen = true;
      onNavToggle();
      nav.classList.add('is-open');
      scrim.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      var first = nav.querySelector('a, button');
      if (first) first.focus();
    }

    function close() {
      navIsOpen = false;
      onNavToggle();
      nav.classList.remove('is-open');
      scrim.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    }

    function isOpen() { return nav.classList.contains('is-open'); }

    toggle.addEventListener('click', function () { isOpen() ? close() : open(); });
    scrim.addEventListener('click', close);

    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { close(); toggle.focus(); }
    });

    // Keep state sane when resizing past the mobile breakpoint (640px), where
    // the drawer stops existing and the nav goes back to being an inline row.
    var timer;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (window.innerWidth > 640 && isOpen()) close();
      }, 150);
    });
  }

  /* ── Scroll-spy for section nav ───────── */
  function initScrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) return;

    var byId = {};
    var sections = [];
    links.forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      var section = document.getElementById(id);
      if (section) { byId[id] = link; sections.push(section); }
    });
    if (!sections.length) return;

    var visible = new Set();

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });

      // Highlight the topmost section currently in view
      var current = sections.filter(function (s) { return visible.has(s.id); })[0];
      links.forEach(function (l) { l.classList.remove('is-active'); });
      if (current && byId[current.id]) byId[current.id].classList.add('is-active');
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sections.forEach(function (s) { observer.observe(s); });
  }

  /* ── FAQ accordion ────────────────────── */
  function initFaq() {
    var items = document.querySelectorAll('.faq-item');

    items.forEach(function (item) {
      var button = item.querySelector('.faq-q');
      var panel = item.querySelector('.faq-a');
      if (!button || !panel) return;

      // Collapsed state is applied here, not in the markup, so that without JS
      // the answers stay both visible and exposed to assistive tech.
      button.setAttribute('aria-expanded', 'false');
      panel.setAttribute('aria-hidden', 'true');

      button.addEventListener('click', function () {
        var willOpen = button.getAttribute('aria-expanded') !== 'true';

        // Close siblings for a cleaner reading experience
        items.forEach(function (other) {
          if (other === item) return;
          var b = other.querySelector('.faq-q');
          var p = other.querySelector('.faq-a');
          if (!b || !p) return;
          other.classList.remove('is-open');
          b.setAttribute('aria-expanded', 'false');
          p.setAttribute('aria-hidden', 'true');
        });

        item.classList.toggle('is-open', willOpen);
        button.setAttribute('aria-expanded', String(willOpen));
        panel.setAttribute('aria-hidden', String(!willOpen));
      });
    });
  }

  /* ── Reveal on scroll ─────────────────── */
  function initReveal() {
    document.documentElement.classList.add('reveal-ready');

    var targets = document.querySelectorAll('.reveal');
    if (!targets.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    targets.forEach(function (el) { observer.observe(el); });
  }

  /* ── Sticky action bar ────────────────── */
  function initActionBar() {
    var bar = document.querySelector('.actionbar');
    var hero = document.querySelector('.hero');
    var contact = document.getElementById('estimate');
    if (!bar || !hero || !('IntersectionObserver' in window)) return;

    document.body.classList.add('has-actionbar');

    var pastHero = false;
    var atContact = false;

    // The label wraps at narrow widths, so the bar's height is not a constant.
    // Publish the measured value for the footer's clearance padding.
    function measure() {
      document.documentElement.style.setProperty('--actionbar-h', bar.offsetHeight + 'px');
    }

    function sync() {
      bar.classList.toggle('is-visible', pastHero && !atContact && !navIsOpen);
    }

    onNavToggle = sync;

    measure();
    var measureTimer;
    window.addEventListener('resize', function () {
      clearTimeout(measureTimer);
      measureTimer = setTimeout(measure, 150);
    }, { passive: true });

    new IntersectionObserver(function (entries) {
      pastHero = !entries[0].isIntersecting;
      sync();
    }, { threshold: 0 }).observe(hero);

    if (contact) {
      new IntersectionObserver(function (entries) {
        atContact = entries[0].isIntersecting;
        sync();
      }, { threshold: 0 }).observe(contact);
    }
  }

  /* ── Contact form validation ──────────── */
  function initForm() {
    var form = document.getElementById('estimateForm');
    if (!form) return;

    var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // At least 10 digits, allowing spaces, dashes, dots, parens and a leading +
    var phoneRe = /^\+?[\d\s().-]{10,}$/;

    function digits(value) { return (value.match(/\d/g) || []).length; }

    function validate(field) {
      var value = field.value.trim();
      var ok = true;

      if (field.hasAttribute('required') && !value) ok = false;
      else if (value && field.type === 'email') ok = emailRe.test(value);
      else if (value && field.type === 'tel') ok = phoneRe.test(value) && digits(value) >= 10;

      field.classList.toggle('has-error', !ok);
      field.setAttribute('aria-invalid', String(!ok));
      return ok;
    }

    var fields = Array.prototype.slice.call(
      form.querySelectorAll('input[required], select[required], textarea[required], input[type="email"], input[type="tel"]')
    );

    fields.forEach(function (field) {
      field.addEventListener('blur', function () { validate(field); });
      field.addEventListener('input', function () {
        if (field.classList.contains('has-error')) validate(field);
      });
    });

    form.addEventListener('submit', function (e) {
      var firstBad = null;

      fields.forEach(function (field) {
        if (!validate(field) && !firstBad) firstBad = field;
      });

      if (firstBad) {
        e.preventDefault();
        firstBad.focus();
        firstBad.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }
    });
  }

  /* ── Success banner after form redirect ─ */
  function initSuccessBanner() {
    var banner = document.getElementById('formSuccess');
    if (!banner) return;

    var params = new URLSearchParams(window.location.search);
    if (params.get('sent') !== 'true') return;

    banner.hidden = false;
    banner.setAttribute('tabindex', '-1');
    banner.focus({ preventScroll: true });
    banner.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });

    // Drop the query string so a refresh doesn't re-show it
    if (window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
  }

  /* ── Boot ─────────────────────────────── */
  function init() {
    initHeaderMetrics();
    initHeaderState();
    initNav();          // publishes navIsOpen / consumes onNavToggle
    initScrollSpy();
    initFaq();
    initReveal();
    initActionBar();    // assigns onNavToggle, so must follow initNav()
    initForm();
    initSuccessBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
