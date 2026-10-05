import { RenderResult, act, render, screen } from '@testing-library/react-native';
import { ReactTestInstance } from 'react-test-renderer';
import { useRef, useState } from 'react';
import { TestButton } from '../tests/TestButton';
import { SpatialNavigationRoot } from '../Root';
import '../tests/helpers/configureTestRemoteControl';
import { SpatialNavigationVirtualizedList } from './SpatialNavigationVirtualizedList';
import { DefaultFocus } from '../../context/DefaultFocusContext';
import testRemoteControlManager from '../tests/helpers/testRemoteControlManager';
import { setComponentLayoutSize } from '../../../testing/setComponentLayoutSize';
import { SpatialNavigationVirtualizedListRef } from '../../types/SpatialNavigationVirtualizedListRef';
import { ScrollBehavior } from './VirtualizedList';
import { SpatialNavigationNode } from '../Node';

// With a loop, the same item can be rendered several times: the focused one is the only one selected
const expectButtonToHaveFocus = (component: RenderResult, text: string) => {
  const selected = component.getAllByRole('button', { selected: true });
  expect(selected).toHaveLength(1);
  expect(selected[0]).toHaveAccessibleName(text);
};

const expectListToHaveScroll = (listElement: ReactTestInstance, scrollValue: number) =>
  expect(listElement).toHaveStyle({ transform: [{ translateX: scrollValue }] });

const listTestId = 'loop-list';

describe('SpatialNavigationVirtualizedList with loop', () => {
  let listRef: React.RefObject<SpatialNavigationVirtualizedListRef | null>;
  const renderedIndexes: number[] = [];

  const Items = ({
    numberOfItems,
    scrollBehavior,
  }: {
    numberOfItems: number;
    scrollBehavior?: ScrollBehavior;
  }) => {
    listRef = useRef<SpatialNavigationVirtualizedListRef>(null);
    const data = useRef(
      Array.from({ length: numberOfItems }, (_, i) => ({ label: `item ${i + 1}` })),
    ).current;
    return (
      <SpatialNavigationRoot>
        <DefaultFocus>
          <SpatialNavigationVirtualizedList
            ref={listRef}
            testID={listTestId}
            loop
            scrollBehavior={scrollBehavior}
            data={data}
            itemSize={100}
            renderItem={({ item, index }) => {
              renderedIndexes.push(index);
              return <TestButton title={item.label} onSelect={() => undefined} />;
            }}
          />
        </DefaultFocus>
      </SpatialNavigationRoot>
    );
  };

  const renderLoopList = async (numberOfItems = 5, scrollBehavior?: ScrollBehavior) => {
    const component = render(
      <Items numberOfItems={numberOfItems} scrollBehavior={scrollBehavior} />,
    );
    act(() => jest.runAllTimers());
    setComponentLayoutSize(listTestId, component, { width: 300, height: 300 });
    const listElement = await component.findByTestId(listTestId);
    return { component, listElement };
  };

  beforeEach(() => {
    renderedIndexes.length = 0;
  });

  it('starts like a regular list', async () => {
    const { component, listElement } = await renderLoopList();

    expectButtonToHaveFocus(component, 'item 1');
    expectListToHaveScroll(listElement, 0);
    expect(screen.getByText('item 2')).toBeTruthy();
  });

  it('only gives logical indexes to renderItem', async () => {
    const { component } = await renderLoopList();
    for (let i = 0; i < 12; i++) testRemoteControlManager.handleRight();

    expectButtonToHaveFocus(component, 'item 3');
    expect(renderedIndexes.length).toBeGreaterThan(0);
    expect(renderedIndexes.every((index) => index >= 0 && index < 5)).toBe(true);
  });

  it('loops forward over the end of the data with a fixed scroll position', async () => {
    const { component, listElement } = await renderLoopList();

    const expected = ['item 2', 'item 3', 'item 4', 'item 5', 'item 1', 'item 2', 'item 3'];
    expected.forEach((label, i) => {
      testRemoteControlManager.handleRight();
      expectButtonToHaveFocus(component, label);
      // The focused item always stays at the start of the list: the scroll is never clamped
      expectListToHaveScroll(listElement, -(i + 1) * 100);
    });
  });

  it('keeps looping over many cycles', async () => {
    const { component, listElement } = await renderLoopList(4);

    for (let i = 1; i <= 25; i++) {
      testRemoteControlManager.handleRight();
      expectButtonToHaveFocus(component, `item ${(i % 4) + 1}`);
      expectListToHaveScroll(listElement, -i * 100);
    }
  });

  it('loops backward from the first item to the last one', async () => {
    const { component, listElement } = await renderLoopList();

    testRemoteControlManager.handleLeft();
    expectButtonToHaveFocus(component, 'item 5');
    expectListToHaveScroll(listElement, 100);

    testRemoteControlManager.handleLeft();
    expectButtonToHaveFocus(component, 'item 4');
    expectListToHaveScroll(listElement, 200);
  });

  it('goes back and forth over the boundaries of the data', async () => {
    const { component } = await renderLoopList();

    for (let i = 0; i < 12; i++) testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 3');
    for (let i = 0; i < 24; i++) testRemoteControlManager.handleLeft();
    expectButtonToHaveFocus(component, 'item 4');
  });

  it('works when there are fewer items than visible items', async () => {
    const { component } = await renderLoopList(2);

    expect(screen.getAllByText('item 1').length).toBeGreaterThan(1);
    testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 2');
    testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 1');
    testRemoteControlManager.handleLeft();
    expectButtonToHaveFocus(component, 'item 2');
  });

  it('works with a single item', async () => {
    const { component } = await renderLoopList(1);

    testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 1');
    testRemoteControlManager.handleLeft();
    testRemoteControlManager.handleLeft();
    expectButtonToHaveFocus(component, 'item 1');
  });

  it('focuses the closest item with the ref, with a logical index', async () => {
    const { component } = await renderLoopList();

    act(() => listRef.current?.focus(3));
    act(() => jest.runAllTimers());
    expectButtonToHaveFocus(component, 'item 4');

    // Moving right from there goes to the next logical item
    testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 5');
    testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 1');
    expect(listRef.current?.currentlyFocusedItemIndex).toBe(0);
  });

  it.each<ScrollBehavior>(['stick-to-end', 'jump-on-scroll'])(
    'does not loop and logs an error with %s',
    async (scrollBehavior) => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const { component } = await renderLoopList(3, scrollBehavior);

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('"loop" prop only supports'),
      );
      for (let i = 0; i < 5; i++) testRemoteControlManager.handleRight();
      expectButtonToHaveFocus(component, 'item 3');
      consoleError.mockRestore();
    },
  );

  it('keeps the number of registered items bounded', async () => {
    await renderLoopList(5);
    for (let i = 0; i < 60; i++) testRemoteControlManager.handleRight();

    // Only the items around the focus are rendered, whatever the number of cycles done
    expect(screen.queryAllByRole('button').length).toBeLessThan(15);
  });

  it('focuses the first item when the focus enters the list from another element', async () => {
    const component = render(
      <SpatialNavigationRoot>
        <SpatialNavigationNode orientation="vertical">
          <>
            <DefaultFocus>
              <TestButton title="above" onSelect={() => undefined} />
            </DefaultFocus>
            <SpatialNavigationVirtualizedList
              testID={listTestId}
              loop
              data={Array.from({ length: 5 }, (_, i) => ({ label: `item ${i + 1}` }))}
              itemSize={100}
              renderItem={({ item }) => (
                <TestButton title={item.label} onSelect={() => undefined} />
              )}
            />
          </>
        </SpatialNavigationNode>
      </SpatialNavigationRoot>,
    );
    act(() => jest.runAllTimers());
    setComponentLayoutSize(listTestId, component, { width: 300, height: 300 });

    testRemoteControlManager.handleDown();
    expectButtonToHaveFocus(component, 'item 1');
    testRemoteControlManager.handleUp();
    expectButtonToHaveFocus(component, 'above');
  });

  it('keeps the focus on the same logical item when the data changes', async () => {
    let setNumberOfItems: (n: number) => void = () => undefined;
    const Wrapper = () => {
      const [numberOfItems, set] = useState(5);
      setNumberOfItems = set;
      const data = useRef<Record<number, { label: string }[]>>({}).current;
      data[numberOfItems] ??= Array.from({ length: numberOfItems }, (_, i) => ({
        label: `item ${i + 1}`,
      }));
      return (
        <SpatialNavigationRoot>
          <DefaultFocus>
            <SpatialNavigationVirtualizedList
              testID={listTestId}
              loop
              data={data[numberOfItems]}
              itemSize={100}
              renderItem={({ item }) => (
                <TestButton title={item.label} onSelect={() => undefined} />
              )}
            />
          </DefaultFocus>
        </SpatialNavigationRoot>
      );
    };
    const component = render(<Wrapper />);
    act(() => jest.runAllTimers());
    setComponentLayoutSize(listTestId, component, { width: 300, height: 300 });

    testRemoteControlManager.handleRight();
    testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 3');

    act(() => setNumberOfItems(8));
    act(() => jest.runAllTimers());
    expectButtonToHaveFocus(component, 'item 3');
    testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 4');

    act(() => setNumberOfItems(3));
    act(() => jest.runAllTimers());
    // item 4 does not exist anymore: the focus is on the last item
    expectButtonToHaveFocus(component, 'item 3');
    testRemoteControlManager.handleRight();
    expectButtonToHaveFocus(component, 'item 1');
  });
});
