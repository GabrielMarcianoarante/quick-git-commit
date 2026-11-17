/* Layout do gráfico de branches.
 * Função pura: recebe commits em ordem topológica (filhos antes dos pais) e devolve,
 * para cada linha, em qual coluna fica o commit e quais linhas passam, chegam ou saem.
 * Funciona no painel (window.QGCGraph) e em Node (require), para ser testável. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QGCGraph = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_LANES = 8;

  function firstFree(active) {
    const i = active.indexOf(null);
    if (i >= 0) return i;
    active.push(null);
    return active.length - 1;
  }

  function trim(active) {
    while (active.length && active[active.length - 1] === null) active.pop();
  }

  /**
   * @param {{hash: string, parents: string[]}[]} commits
   * @returns {{rows: Array, lanes: number}}
   *   row = { col, pass: number[], top: number[], bottom: number[] }
   *   - col:    coluna do commit
   *   - pass:   colunas com linha vertical que atravessa a linha sem tocar no commit
   *   - top:    colunas de onde chegam linhas (vindas de cima) até o commit
   *   - bottom: colunas para onde saem linhas (para baixo) a partir do commit
   */
  function layoutGraph(commits) {
    const active = []; // active[i] = hash que a coluna i está esperando
    const rows = [];
    let maxLanes = 1;

    for (const c of commits) {
      const waiting = [];
      active.forEach((h, i) => {
        if (h === c.hash) waiting.push(i);
      });

      let col;
      if (waiting.length) {
        col = waiting[0];
      } else {
        col = firstFree(active);
      }

      const top = waiting.slice();
      const pass = [];
      active.forEach((h, i) => {
        if (h !== null && !waiting.includes(i) && i !== col) pass.push(i);
      });

      // Libera as colunas que terminam neste commit.
      waiting.forEach((i) => {
        active[i] = null;
      });

      const bottom = [];
      const parents = c.parents || [];
      parents.forEach((p, idx) => {
        const existing = active.indexOf(p);
        if (existing >= 0) {
          // O pai já é esperado por outra coluna: a linha converge até lá.
          bottom.push(existing);
        } else if (idx === 0) {
          active[col] = p;
          bottom.push(col);
        } else {
          const free = firstFree(active);
          active[free] = p;
          bottom.push(free);
        }
      });

      // Colunas que continuam ativas depois deste commit e não nasceram dele.
      const lanesNow = Math.max(active.length, col + 1, ...top.map((i) => i + 1), ...bottom.map((i) => i + 1));
      maxLanes = Math.max(maxLanes, lanesNow);
      rows.push({ col, pass, top, bottom });
      trim(active);
    }

    return { rows, lanes: Math.min(maxLanes, MAX_LANES), rawLanes: maxLanes };
  }

  const PALETTE = ['#4c9aff', '#36b37e', '#ffab00', '#ff5630', '#a78bfa', '#2dd4bf', '#f472b6', '#9ca3af'];
  const colorOf = (lane) => PALETTE[Math.min(lane, MAX_LANES - 1) % PALETTE.length];
  const clamp = (lane) => Math.min(lane, MAX_LANES - 1);

  return { layoutGraph, colorOf, clamp, MAX_LANES, PALETTE };
});
