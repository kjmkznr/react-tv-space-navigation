import { computeAllScrollOffsets } from './createScrollOffsetArray';
import { computeTranslation } from './computeTranslation';
import { computeItemOffsets } from './getSizeInPxFromOneItemToAnother';
import { getLastLeftItemIndex, getLastRightItemIndex } from './getLastItemIndex';
import { ScrollBehavior } from '../VirtualizedList';

type Item = { size: number };
const data: Item[] = Array.from({ length: 30 }, (_, i) => ({ size: 50 + ((i * 37) % 90) }));
const sizeOf = (item: Item) => item.size;

describe('computeItemOffsets', () => {
  it('returns the cumulated size of the previous items, and the total size at the end', () => {
    expect(computeItemOffsets([{ size: 10 }, { size: 20 }, { size: 5 }], sizeOf)).toEqual([
      0, 10, 30, 35,
    ]);
    expect(computeItemOffsets([1, 2, 3], 100)).toEqual([0, 100, 200, 300]);
    expect(computeItemOffsets([], 100)).toEqual([0]);
  });
});

describe('computeAllScrollOffsets', () => {
  const behaviors: ScrollBehavior[] = ['stick-to-start', 'stick-to-end'];
  const sizes: Array<[string, number | ((item: Item) => number)]> = [
    ['fixed size', 120],
    ['variable size', sizeOf],
  ];

  describe.each(sizes)('with %s', (_, itemSize) => {
    it.each(behaviors)(
      'gives the same offsets as the item-by-item computation (%s)',
      (behavior) => {
        const listSizeInPx = 700;
        const params = {
          itemSize,
          nbMaxOfItems: data.length,
          numberOfItemsVisibleOnScreen: 5,
          scrollBehavior: behavior,
          data,
          listSizeInPx,
        };
        const expected = data.map((_, index) =>
          computeTranslation({
            currentlyFocusedItemIndex: index,
            itemSizeInPx: itemSize,
            nbMaxOfItems: params.nbMaxOfItems,
            numberOfItemsVisibleOnScreen: params.numberOfItemsVisibleOnScreen,
            scrollBehavior: behavior,
            data,
            listSizeInPx,
            maxPossibleLeftAlignedIndex: getLastLeftItemIndex(data, itemSize, listSizeInPx),
            maxPossibleRightAlignedIndex: getLastRightItemIndex(data, itemSize, listSizeInPx),
          }),
        );

        expect(computeAllScrollOffsets(params)).toEqual(expected);
      },
    );
  });
});
