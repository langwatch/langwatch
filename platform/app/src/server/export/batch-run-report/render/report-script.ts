/**
 * The report's only script, verbatim.
 *
 * Interpolates nothing on purpose. Everything the page knows is already in the
 * markup, so the script never has to embed run data, which is what makes "the
 * document contains exactly one script and its body is this constant" a check a
 * test can make rather than a convention to remember.
 *
 * ES5-flavoured and framework-free: the file is opened from disk on whatever
 * browser the reader happens to have, offline, with no build step behind it.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
export const REPORT_SCRIPT = `(function () {
  "use strict";
  function sortKey(row, index) {
    var cell = row.children[index];
    if (!cell) return "";
    var explicit = cell.getAttribute("data-sort-value");
    return explicit === null ? cell.textContent || "" : explicit;
  }
  function compare(a, b) {
    var na = Number(a);
    var nb = Number(b);
    if (a !== "" && b !== "" && !isNaN(na) && !isNaN(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function sortRows(table, index, ascending) {
    var body = table.tBodies[0];
    if (!body) return;
    var entries = Array.prototype.map.call(body.rows, function (row, position) {
      return { row: row, position: position, key: sortKey(row, index) };
    });
    entries.sort(function (a, b) {
      var order = compare(a.key, b.key);
      // Ties keep their original order, so re-sorting never reshuffles equals.
      return order === 0 ? a.position - b.position : order * (ascending ? 1 : -1);
    });
    entries.forEach(function (entry) { body.appendChild(entry.row); });
  }
  function setAll(open) {
    Array.prototype.forEach.call(document.querySelectorAll("details"), function (item) {
      item.open = open;
    });
  }
  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var toggle = target.closest("[data-details]");
    if (toggle) { setAll(toggle.getAttribute("data-details") === "expand"); return; }
    var header = target.closest("thead th[data-sortable]");
    if (!header) return;
    var headers = Array.prototype.slice.call(header.parentNode.children);
    var ascending = header.getAttribute("aria-sort") !== "ascending";
    headers.forEach(function (other) { other.setAttribute("aria-sort", "none"); });
    header.setAttribute("aria-sort", ascending ? "ascending" : "descending");
    sortRows(header.closest("table"), headers.indexOf(header), ascending);
  });
  var restore = [];
  window.addEventListener("beforeprint", function () {
    restore = [];
    Array.prototype.forEach.call(document.querySelectorAll("details"), function (item) {
      restore.push([item, item.open]);
      item.open = true;
    });
  });
  window.addEventListener("afterprint", function () {
    restore.forEach(function (entry) { entry[0].open = entry[1]; });
    restore = [];
  });
})();`;
