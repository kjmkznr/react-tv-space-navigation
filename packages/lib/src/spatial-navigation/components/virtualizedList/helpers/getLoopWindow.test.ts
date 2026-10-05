import { getLoopWindow, getLogicalIndex } from './getLoopWindow';

const N = 10;
const base = { dataLength: N, lookahead: 4, lookbehind: 4 };

describe('getLogicalIndex', () => {
  it('wraps positive and negative indexes', () => {
    expect(getLogicalIndex(0, N)).toBe(0);
    expect(getLogicalIndex(23, N)).toBe(3);
    expect(getLogicalIndex(-1, N)).toBe(9);
    expect(getLogicalIndex(-10, N)).toBe(0);
  });
});

describe('getLoopWindow', () => {
  it('builds an initial window around the focus, made of whole cycles', () => {
    expect(getLoopWindow({ ...base, focusedIndex: 0 })).toEqual({ start: -10, end: 10 });
  });

  it('fills the screen when there are fewer items than needed', () => {
    const window = getLoopWindow({ dataLength: 3, focusedIndex: 0, lookahead: 8, lookbehind: 8 });
    expect(Math.abs(window.start % 3)).toBe(0);
    expect(Math.abs(window.end % 3)).toBe(0);
    expect(window.start).toBeLessThanOrEqual(-8);
    expect(window.end).toBeGreaterThanOrEqual(9);
  });

  it('returns the previous window when nothing changes', () => {
    const previous = getLoopWindow({ ...base, focusedIndex: 0 });
    expect(getLoopWindow({ ...base, focusedIndex: 2, previous })).toBe(previous);
  });

  it('appends a cycle when the focus gets close to the end', () => {
    const previous = { start: -10, end: 10 };
    expect(getLoopWindow({ ...base, focusedIndex: 5, previous })).toEqual({ start: -10, end: 10 });
    expect(getLoopWindow({ ...base, focusedIndex: 6, previous })).toEqual({ start: -10, end: 20 });
  });

  it('prepends a cycle when the focus gets close to the start', () => {
    const previous = { start: 0, end: 20 };
    expect(getLoopWindow({ ...base, focusedIndex: 4, previous })).toEqual({ start: 0, end: 20 });
    expect(getLoopWindow({ ...base, focusedIndex: 3, previous })).toEqual({ start: -10, end: 20 });
  });

  it('removes a cycle only when it is further than the hysteresis margin', () => {
    const previous = { start: -10, end: 20 };
    // needed start = 14 - 4 = 10 ; start + N + margin = 4 <= 10 -> cycle [-10, 0) removed
    expect(getLoopWindow({ ...base, focusedIndex: 14, previous }).start).toBe(0);
    // needed start = 13 - 4 = 9 ; start + N + margin = 4 <= 9 -> removed as well, but not at 3
    expect(getLoopWindow({ ...base, focusedIndex: 3, previous }).start).toBe(-10);
  });

  it('does not add and remove the same cycle when moving back and forth', () => {
    let window = getLoopWindow({ ...base, focusedIndex: 0 });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      window = getLoopWindow({ ...base, focusedIndex: i, previous: window });
      seen.add(JSON.stringify(window));
    }
    const forward = seen.size;
    for (let i = 40; i >= 0; i--) {
      window = getLoopWindow({ ...base, focusedIndex: i, previous: window });
    }
    // oscillating around a boundary must not change the window every step
    let changes = 0;
    for (let i = 0; i < 20; i++) {
      const next = getLoopWindow({ ...base, focusedIndex: 20 + (i % 2), previous: window });
      if (next !== window) changes++;
      window = next;
    }
    expect(changes).toBeLessThanOrEqual(2);
    expect(forward).toBeGreaterThan(1);
  });

  it('always contains the needed range and whole cycles', () => {
    let window = getLoopWindow({ ...base, focusedIndex: 0 });
    for (const focus of [0, 7, 15, 31, 12, -3, -25, 0, 100, 99]) {
      window = getLoopWindow({ ...base, focusedIndex: focus, previous: window });
      expect(Math.abs(window.start % N)).toBe(0);
      expect(Math.abs(window.end % N)).toBe(0);
      expect(window.start).toBeLessThanOrEqual(focus - base.lookbehind);
      expect(window.end).toBeGreaterThanOrEqual(focus + base.lookahead + 1);
    }
  });
});
