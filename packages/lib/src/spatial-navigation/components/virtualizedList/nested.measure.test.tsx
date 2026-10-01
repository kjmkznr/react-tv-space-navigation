import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SpatialNavigationRoot } from '../Root';
import '../tests/helpers/configureTestRemoteControl';
import { SpatialNavigationVirtualizedList } from './SpatialNavigationVirtualizedList';
import { DefaultFocus } from '../../context/DefaultFocusContext';
import testRemoteControlManager from '../tests/helpers/testRemoteControlManager';
import { setComponentLayoutSize } from '../../../testing/setComponentLayoutSize';
import { SpatialNavigationFocusableView } from '../FocusableView';
import SpatialNavigator from '../../SpatialNavigator';
import { SpatialNavigationVirtualizedListRef } from '../../types/SpatialNavigationVirtualizedListRef';

const counters = {
  cardRender: 0,
  cardMount: 0,
  cardUnmount: 0,
  rowRender: 0,
  register: 0,
  unregister: 0,
};
const reset = () => {
  counters.cardRender = 0;
  counters.cardMount = 0;
  counters.cardUnmount = 0;
  counters.rowRender = 0;
};

const Card = ({ r, c }: { r: number; c: number }) => {
  counters.cardRender++;
  useEffect(() => {
    counters.cardMount++;
    return () => {
      counters.cardUnmount++;
    };
  }, []);
  return (
    <SpatialNavigationFocusableView>
      <View testID={`card-${r}-${c}`} />
    </SpatialNavigationFocusableView>
  );
};

const rows = Array.from({ length: 12 }, (_, r) => ({
  r,
  cards: Array.from({ length: 20 }, (_, c) => ({ c })),
}));

const rowRefs: Record<number, SpatialNavigationVirtualizedListRef | null> = {};

const renderRow = ({ item }: { item: (typeof rows)[number] }) => {
  counters.rowRender++;
  return (
    <SpatialNavigationVirtualizedList
      ref={(el) => {
        rowRefs[item.r] = el;
      }}
      data={item.cards}
      itemSize={100}
      renderItem={({ item: card }) => <Card r={item.r} c={card.c} />}
    />
  );
};

describe('nested virtualized lists (vertical list of horizontal lists)', () => {
  it('does not re-register nodes nor remount cards when rows are recycled', async () => {
    const reg = jest.spyOn(SpatialNavigator.prototype, 'registerNode');
    const unreg = jest.spyOn(SpatialNavigator.prototype, 'unregisterNode');
    const comp = render(
      <SpatialNavigationRoot>
        <DefaultFocus>
          <SpatialNavigationVirtualizedList
            testID="outer"
            orientation="vertical"
            data={rows}
            itemSize={200}
            renderItem={renderRow}
            {...(process.env.KEYED ? { keyExtractor: (i: number) => `row_${i}` } : {})}
          />
        </DefaultFocus>
      </SpatialNavigationRoot>,
    );
    act(() => jest.runAllTimers());
    setComponentLayoutSize('outer', comp, { width: 1000, height: 500 });
    act(() => jest.runAllTimers());
    const out: Array<Record<string, number>> = [];
    for (let i = 0; i < 8; i++) {
      reset();
      reg.mockClear();
      unreg.mockClear();
      testRemoteControlManager.handleDown();
      out.push({
        step: i + 1,
        ...counters,
        register: reg.mock.calls.length,
        unregister: unreg.mock.calls.length,
      });
    }
    // Moving between rows recycles the nested lists: it must not re-register their LRUD nodes nor remount cards.
    // Per-step numbers (printed on failure) are the metrics to compare when optimizing.
    out.forEach((o) => {
      expect(o).toMatchObject({ cardMount: 0, cardUnmount: 0, register: 0, unregister: 0 });
    });
  });

  it('does not carry the horizontal scroll position of a row over to the row that recycles it', () => {
    const comp = render(
      <SpatialNavigationRoot>
        <DefaultFocus>
          <SpatialNavigationVirtualizedList
            testID="outer"
            orientation="vertical"
            data={rows}
            itemSize={200}
            renderItem={renderRow}
          />
        </DefaultFocus>
      </SpatialNavigationRoot>,
    );
    act(() => jest.runAllTimers());
    setComponentLayoutSize('outer', comp, { width: 1000, height: 500 });
    act(() => jest.runAllTimers());

    for (let i = 0; i < 3; i++) testRemoteControlManager.handleRight();
    expect(rowRefs[0]?.currentlyFocusedItemIndex).toBe(3);

    // Rows 3 to 6 are not focused yet: row 6 is rendered by the instance that rendered row 0.
    for (let i = 0; i < 3; i++) testRemoteControlManager.handleDown();
    expect(
      Object.fromEntries(
        Object.entries(rowRefs).map(([r, x]) => [r, x?.currentlyFocusedItemIndex]),
      ),
    ).toMatchObject({ 6: 0 });
    // And entering it must not jump to the item remembered from row 0.
    for (let i = 0; i < 3; i++) testRemoteControlManager.handleDown();
    expect(rowRefs[6]?.currentlyFocusedItemIndex).toBe(0);
  });
});
