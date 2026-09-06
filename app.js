/*
 * Motion layer for the skill library.
 *
 * This script attaches motion to markup that build.py has already prerendered.
 * It never creates a card, a chapter or a rail link. That matters: the page must
 * be complete for a crawler and readable with JavaScript disabled, so the DOM is
 * the source of truth and this file is a progressive enhancement over it.
 *
 * Per-chapter geometry is read from data attributes on each .chapter
 * (data-before, data-count, data-label) rather than from a parallel JS dataset,
 * so the numbers on screen cannot drift from the markup.
 *
 * Bails out cleanly, leaving the plain prerendered page, when:
 *   - GSAP or ScrollTrigger failed to load from the CDN
 *   - the viewport is at or below the mobile breakpoint (native scroll-snap
 *     swipe is used there instead of pinning)
 *   - the reader has prefers-reduced-motion set
 */
(function () {
  "use strict";

  var MOBILE = 860;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var total = (window.SKILLDATA && window.SKILLDATA.total) || 0;

  var hudCount = document.getElementById("hudcount");
  var bar = document.getElementById("bar");
  var rail = document.getElementById("rail");
  var mosaic = document.getElementById("mosaic");
  var heroCount = document.getElementById("herocount");
  var hero = document.getElementById("top");
  var cue = document.getElementById("cue");

  function pad(n, w) {
    n = String(Math.max(0, Math.round(n)));
    while (n.length < w) n = "0" + n;
    return n;
  }

  function setHud(seen, label) {
    if (!hudCount) return;
    hudCount.textContent = "";
    var b = document.createElement("b");
    b.textContent = pad(seen, 3);
    hudCount.appendChild(b);
    hudCount.appendChild(
      document.createTextNode(" / " + total + (label ? "   " + label : ""))
    );
  }

  // Read chapter geometry straight off the prerendered markup.
  var chapters = Array.prototype.slice
    .call(document.querySelectorAll(".chapter"))
    .map(function (section) {
      return {
        section: section,
        stage: section.querySelector(".chapter__stage"),
        mask: section.querySelector(".strip__mask"),
        strip: section.querySelector(".strip"),
        ghost: section.querySelector(".chapter__ghost"),
        head: section.querySelector(".chapter__head"),
        cards: Array.prototype.slice.call(section.querySelectorAll(".card")),
        before: parseInt(section.getAttribute("data-before"), 10) || 0,
        count: parseInt(section.getAttribute("data-count"), 10) || 0,
        label: section.getAttribute("data-label") || ""
      };
    });

  var enhanced =
    !reduced &&
    window.innerWidth > MOBILE &&
    typeof window.gsap !== "undefined" &&
    typeof window.ScrollTrigger !== "undefined" &&
    chapters.length > 0;

  if (!enhanced) {
    // Plain prerendered page. Keep the HUD truthful rather than stuck at zero.
    setHud(total, "");
    if (bar) bar.style.transform = "scaleX(1)";
    document.documentElement.classList.add("is-static");
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  document.documentElement.classList.add("is-enhanced");

  // Progress starts at nothing: no category has been travelled yet.
  setHud(0, "");

  // Smooth scrolling, driven from GSAP's ticker so there is exactly one rAF
  // loop on the page rather than Lenis and GSAP each running their own.
  var lenis = null;
  if (typeof window.Lenis !== "undefined") {
    lenis = new Lenis({ duration: 0.9, smoothWheel: true });
    gsap.ticker.add(function (time) {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
    lenis.on("scroll", ScrollTrigger.update);
  }

  if (rail) {
    rail.addEventListener("click", function (e) {
      var a = e.target.closest("a");
      if (!a) return;
      var target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target, { offset: 1 });
      else target.scrollIntoView({ behavior: "smooth" });
    });
  }

  /* ---------------------------------------------------------------- hero
   * Pull back from a mosaic of one tile per skill to the headline, counting the
   * total up as it goes. The opening image is the shape of the real library.
   */
  if (mosaic && hero) {
    var counter = { v: 0 };
    gsap
      .timeline({
        scrollTrigger: {
          trigger: hero,
          start: "top top",
          end: "+=140%",
          scrub: 0.6,
          pin: true,
          anticipatePin: 1
        }
      })
      .fromTo(
        mosaic,
        { scale: 7, opacity: 0.25 },
        { scale: 1, opacity: 1, ease: "none" },
        0
      )
      .to(counter, {
        v: total,
        ease: "none",
        duration: 1,
        onUpdate: function () {
          // Only the hero's own number. Writing the total into the HUD here made
          // the HUD mean "size of the library" during the hero and "skills
          // passed so far" during the chapters, so it counted up to 431 and then
          // dropped back to 109. The HUD means progress, and nothing else.
          if (heroCount) heroCount.textContent = Math.round(counter.v);
        }
      }, 0)
      .fromTo(
        ".hero__inner",
        { opacity: 0, y: 26 },
        { opacity: 1, y: 0, ease: "power2.out", duration: 0.45 },
        0.12
      )
      .to(cue, { opacity: 0, duration: 0.2 }, 0.55);
  }

  /* ------------------------------------------------------------ chapters
   * One pinned chapter per category. Scroll scrubs the filmstrip of cards
   * horizontally through the frame, so browsing a category is the scroll itself
   * rather than a list you skim past.
   */
  chapters.forEach(function (ch) {
    if (!ch.strip || !ch.mask || ch.cards.length === 0) return;

    function travel() {
      // How far the strip must move for the last card to reach the frame edge.
      return Math.max(0, ch.strip.scrollWidth - ch.mask.clientWidth);
    }

    // Pin length is proportional to the number of cards, floored so a
    // one-skill category still gets a beat and capped so a 100-skill category
    // does not become an endurance test.
    var pinLength = Math.min(5200, Math.max(700, ch.count * 118));

    // Cards start dimmed but readable. Anything near 0.3 read as empty space
    // against this background rather than as a card waiting its turn.
    gsap.set(ch.cards, { opacity: 0.72, y: 14 });

    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: ch.section,
        start: "top top",
        end: "+=" + pinLength,
        scrub: 0.7,
        pin: ch.stage,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onToggle: function (self) {
          ch.section.classList.toggle("is-live", self.isActive);
          if (!self.isActive || !rail) return;
          var here = rail.querySelector("a.is-here");
          if (here) here.classList.remove("is-here");
          var link = rail.querySelector('a[href="#' + ch.section.id + '"]');
          if (link) link.classList.add("is-here");
        },
        onUpdate: function (self) {
          setHud(ch.before + self.progress * ch.count, ch.label);
          if (bar) {
            gsap.set(bar, {
              scaleX: (ch.before + self.progress * ch.count) / total
            });
          }
        }
      }
    });

    tl.to(
      ch.strip,
      {
        // Negative: the strip travels LEFT so card 1 leads and card N arrives last.
        x: function () {
          return -travel();
        },
        ease: "none",
        duration: 1
      },
      0
    );

    // Card reveals sit on this same scrubbed timeline. A separate ScrollTrigger
    // per card cannot work here: the cards are being translated by GSAP, so
    // their position relative to the viewport is not something a normal trigger
    // can observe.
    ch.cards.forEach(function (card, i) {
      var at = ch.cards.length > 1 ? (i / ch.cards.length) * 0.94 : 0;
      tl.to(
        card,
        { opacity: 1, y: 0, ease: "power1.out", duration: 0.08 },
        at
      );
    });

    // Ghost wordmark drifts against the strip to give the pinned frame depth.
    if (ch.ghost) {
      tl.fromTo(
        ch.ghost,
        { xPercent: 6 },
        { xPercent: -6, ease: "none", duration: 1 },
        0
      );
    }
    if (ch.head) {
      tl.fromTo(
        ch.head,
        { opacity: 0, y: 22 },
        { opacity: 1, y: 0, ease: "power2.out", duration: 0.12 },
        0
      );
    }
  });

  // Recompute geometry once webfonts land, since card widths and therefore
  // strip travel depend on the rendered font.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      ScrollTrigger.refresh();
    });
  }

  // Crossing the mobile breakpoint changes the whole strategy (pinning vs
  // native swipe), so reload rather than trying to tear GSAP down in place.
  var wasDesktop = window.innerWidth > MOBILE;
  var t;
  window.addEventListener("resize", function () {
    clearTimeout(t);
    t = setTimeout(function () {
      var isDesktop = window.innerWidth > MOBILE;
      if (isDesktop !== wasDesktop) window.location.reload();
      else ScrollTrigger.refresh();
    }, 250);
  });
})();
