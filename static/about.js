// About page (header button): author, thanks, licence.
function openAbout() {
  if ($("aboutBox")) return;
  const el = document.createElement("div"); el.className = "modal-back"; el.id = "aboutBox";
  el.innerHTML = `<div class="modal about" role="dialog" aria-modal="true" aria-labelledby="abT">
    <button class="btn sm ghost xclose" id="abX" title="Close (Esc)">✕</button>
    <img class="aboutlogo" src="/static/brand/logo.svg" alt="bbx analyzer" width="300" height="80">
    <h2 id="abT">About</h2>
    <p>BBX Analyzer turns a Betaflight blackbox log into answers: what the noise is and where it comes from, how the tune tracks your sticks, how the motors are doing,
      and what to try next, with every suggestion tied to what the log actually shows.</p>
    <h3>Author</h3>
    <p><b>Martin Dimitrievski</b></p>
    <h3>Thank you</h3>
    <p>To the FPV community: the pilots who share their logs, tunes and crashes, the Betaflight developers and everyone who has spent nights documenting filters, PIDs and
      blackbox fields so the rest of us can understand our quads. This tool stands on that shared knowledge. Fly safe, and keep sharing.</p>
    <h3>Licence</h3>
    <p>Free to <b>use, reuse, modify and share for non-commercial purposes</b>. Keep the author credit and this notice in copies and derived versions.
      Commercial use (selling it, or bundling it into a paid product or service) needs the author's written permission.</p>
    <p class="hint">Provided as is, without warranty of any kind. Tuning suggestions and the PID simulator are illustrative; you are responsible for what you flash and fly.</p>
    <div class="modal-btns"><button class="btn primary" id="abOk">Close</button></div></div>`;
  document.body.appendChild(el); document.body.classList.add("modal-open");
  const close = () => { el.remove(); document.body.classList.remove("modal-open"); };
  el.addEventListener("click", e => { if (e.target === el) close(); });
  $("abX").onclick = $("abOk").onclick = close;
  el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  setTimeout(() => $("abOk").focus(), 30);
}
$("aboutBtn").onclick = openAbout;
