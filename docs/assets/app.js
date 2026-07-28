// Language toggle (EN <-> 中文) + image lightbox
(function () {
  var KEY = "cc-stagehand-lang";
  var btn = document.getElementById("langToggle");

  function apply(lang) {
    if (lang === "zh") {
      document.body.classList.add("zh");
      if (btn) btn.textContent = "EN";
      document.documentElement.setAttribute("lang", "zh-CN");
    } else {
      document.body.classList.remove("zh");
      if (btn) btn.textContent = "中文";
      document.documentElement.setAttribute("lang", "en");
    }
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (!saved) {
    saved = (navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  }
  apply(saved);

  if (btn) {
    btn.addEventListener("click", function () {
      var next = document.body.classList.contains("zh") ? "en" : "zh";
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
    });
  }

  // Lightbox
  var lb = document.getElementById("lightbox");
  var lbImg = lb ? lb.querySelector("img") : null;
  document.querySelectorAll(".shot img").forEach(function (img) {
    img.addEventListener("click", function () {
      if (!lb || !lbImg) return;
      lbImg.src = img.src;
      lbImg.alt = img.alt;
      lb.classList.add("open");
    });
  });
  if (lb) {
    lb.addEventListener("click", function () { lb.classList.remove("open"); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") lb.classList.remove("open");
    });
  }

  // Footer year
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
