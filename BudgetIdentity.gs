/** Stable identity preparation. Pure: never mutates the input snapshot. */
function finplanePrepareBudgetIds(logs, makeId) {
  if (!Array.isArray(logs)) throw new Error("budgetLogs must be an array");
  if (typeof makeId !== "function") throw new Error("ID factory required");
  var copy = JSON.parse(JSON.stringify(logs));
  var operations = Object.create(null);
  function key(value) { return value == null ? "" : String(value).trim(); }
  copy.forEach(function(log) {
    if (!log || typeof log !== "object" || Array.isArray(log)) throw new Error("Invalid operation");
    var id = key(log.id);
    if (id) {
      if (operations[id]) throw new Error("Duplicate operation ID: " + id);
      operations[id] = true;
    }
    if (log.items != null && !Array.isArray(log.items)) throw new Error("Invalid items");
  });
  function fresh(used) {
    for (var n = 0; n < 100; n++) {
      var id = key(makeId());
      if (id && !used[id]) { used[id] = true; return id; }
    }
    throw new Error("Cannot generate unique ID");
  }
  copy.forEach(function(log) {
    if (!key(log.id)) log.id = fresh(operations);
    var items = log.items || [], used = Object.create(null);
    items.forEach(function(item) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid item");
      var id = key(item.id);
      if (id) {
        if (used[id]) throw new Error("Duplicate item ID: " + id);
        used[id] = true;
      }
    });
    items.forEach(function(item) { if (!key(item.id)) item.id = fresh(used); });
  });
  return copy;
}
if (typeof module !== "undefined" && module.exports) module.exports = finplanePrepareBudgetIds;
