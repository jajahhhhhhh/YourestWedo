// Home page photo strip: scroll-snap track that moves on by itself every
// few seconds. It pauses while the visitor hovers, focuses or touches it,
// stops for good after they use the arrows or swipe, and never moves on its
// own for people who prefer reduced motion.
(function () {
  "use strict";
  var root = document.querySelector("[data-hero-gallery]");
  if (!root) return;
  var view = root.querySelector(".hg-viewport");
  var slides = root.querySelectorAll(".hg-slide");
  if (!view || !slides.length) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function step() { return slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : view.clientWidth; }
  function atEnd() { return view.scrollLeft + view.clientWidth >= view.scrollWidth - 4; }
  function go(dir) {
    if (dir > 0 && atEnd()) view.scrollTo({ left: 0, behavior: reduce ? "auto" : "smooth" });
    else if (dir < 0 && view.scrollLeft <= 4) view.scrollTo({ left: view.scrollWidth, behavior: reduce ? "auto" : "smooth" });
    else view.scrollBy({ left: dir * step(), behavior: reduce ? "auto" : "smooth" });
  }

  var stopped = reduce, paused = false, timer = null;
  function stop() { stopped = true; clearInterval(timer); }
  root.querySelector('[data-hg="prev"]').addEventListener("click", function () { stop(); go(-1); });
  root.querySelector('[data-hg="next"]').addEventListener("click", function () { stop(); go(1); });
  view.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { e.preventDefault(); stop(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); stop(); go(-1); }
  });
  view.addEventListener("touchstart", stop, { passive: true });
  view.addEventListener("wheel", function (e) { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) stop(); }, { passive: true });
  root.addEventListener("mouseenter", function () { paused = true; });
  root.addEventListener("mouseleave", function () { paused = false; });
  root.addEventListener("focusin", function () { paused = true; });
  root.addEventListener("focusout", function () { paused = false; });

  if (!stopped) {
    timer = setInterval(function () {
      if (!paused && !document.hidden) go(1);
    }, 4000);
  }
})();
