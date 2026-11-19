/* 상세 모듈 배치 잠금 — 남이 화면을 볼 때 모듈 배치가 바로 보이지 않게 하는 가림막(보안 장치 아님).
   코드는 이 브라우저에만 해시로 저장(localStorage ldet_h), 풀린 상태는 탭을 닫으면 다시 잠김(sessionStorage). */
(function () {
  var KH = "ldet_h", KO = "ldet_ok";
  function g(s, k) { try { return s.getItem(k); } catch (e) { return null; } }
  function p(s, k, v) { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch (e) {} }
  function sha(t) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode("ldet:" + t)).then(function (b) { return Array.from(new Uint8Array(b)).map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }); }
  var hooks = [];
  function fire() { hooks.forEach(function (f) { try { f(); } catch (e) {} }); }
  window.LDET = {
    ok: function () { return g(sessionStorage, KO) === "1" && !!g(localStorage, KH); },
    onChange: function (f) { hooks.push(f); },
    lock: function () { p(sessionStorage, KO, null); fire(); },
    unlock: function () {
      var h = g(localStorage, KH);
      if (!h) {
        var a = prompt("상세 배치를 볼 때 쓸 코드를 새로 정해 주세요 (4자 이상, 이 브라우저에만 저장)");
        if (!a) return; a = a.trim(); if (a.length < 4) { alert("4자 이상으로 정해 주세요."); return; }
        var b = prompt("확인을 위해 한 번 더 입력해 주세요"); if (b == null) return;
        if (b.trim() !== a) { alert("두 번 입력한 코드가 다릅니다."); return; }
        sha(a).then(function (x) { p(localStorage, KH, x); p(sessionStorage, KO, "1"); fire(); });
        return;
      }
      var c = prompt("코드"); if (!c) return;
      sha(c.trim()).then(function (x) { if (x === h) { p(sessionStorage, KO, "1"); fire(); } else alert("코드가 맞지 않습니다."); });
    },
    reset: function () { if (confirm("상세 배치 코드를 지우고 새로 정할까요?")) { p(localStorage, KH, null); p(sessionStorage, KO, null); fire(); } }
  };
  /* 다른 탭에서 잠그거나 풀면 따라가기는 하지 않음(탭마다 따로). Esc 가리기와 함께 잠금 */
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !e.repeat && window.LDET.ok()) window.LDET.lock(); });
})();
