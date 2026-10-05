import { computeLoopItemOffsets, getLoopWindowSizeInPx } from './computeLoopItemOffsets';

describe('computeLoopItemOffsets', () => {
  it('computes offsets for a fixed size', () => {
    expect(
      computeLoopItemOffsets({ data: ['a', 'b', 'c'], itemSize: 100, startOffsetPx: -300 }),
    ).toEqual([-300, -200, -100]);
  });

  it('computes offsets for a dynamic size', () => {
    const sizes: Record<string, number> = { a: 10, b: 20, c: 30 };
    expect(
      computeLoopItemOffsets({
        data: ['a', 'b', 'c'],
        itemSize: (i) => sizes[i],
        startOffsetPx: 60,
      }),
    ).toEqual([60, 70, 90]);
  });

  it('computes the size of the window', () => {
    expect(getLoopWindowSizeInPx(['a', 'b'], 50)).toBe(100);
    expect(getLoopWindowSizeInPx(['a', 'b'], (i) => (i === 'a' ? 1 : 2))).toBe(3);
  });
});
