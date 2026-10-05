# SpatialNavigationVirtualizedList 無限スクロール(`loop`) — 要件定義 / 設計

ステータス: Draft(レビュー待ち・未実装)

## 1. 背景と目的

`SpatialNavigationVirtualizedList` は有限の `data` を前提にしており、終端に到達するとそれ以上進めない。
カルーセル型 UI(バナー、チャンネル切替など)向けに、**現在の要素を繰り返し表示する無限スクロール**を追加する。

イメージ:

- 初期状態は通常のリストと同じ
- フォーカスは画面上の固定位置(`stick-to-start` / `stick-to-end`)
- 終端に到達しそうになったら、データの先頭を終端に追加する
- ループ側の先頭(2周目の先頭)にフォーカスが移ったら、左側(1周目)の要素を削除する

## 2. 要件

### 2.1 機能要件

| ID | 要件 |
| --- | --- |
| F1 | `loop` prop(既定 `false`)を追加。`false` の時は現行挙動と完全に同一(後方互換) |
| F2 | `loop=true` の初期状態は通常のリストと同一(コピーなし、先頭から表示) |
| F3 | フォーカス位置が終端に近づいたら(先読み量を割った時点)`data` 全体を終端に追加する。ユーザーには「途切れなく続く」ように見える |
| F4 | ループ側の先頭(abs が N の倍数)にフォーカスが移ったら、その左側(前周)の要素を即座に削除する。左側に別の UI がある場合、ループ先頭から左キーでその UI へ移動できる。メモリ・ノード数が周回数に比例して増えない |
| F5 | フォーカスは固定位置のまま。終端でのスクロール停止(clamp)は起きない |
| F6 | `data` が画面に収まらない長さ(例: 3件で画面に8件分)でも、繰り返しで画面が埋まる |
| F7 | `renderItem` / `ref.focus` / `ref.scrollTo` / `ref.currentlyFocusedItemIndex` に露出する index は常に **論理 index(0〜N-1)**。呼び出し側は周回を意識しない |
| F8 | `ref.focus(i)` / `scrollTo(i)` は、現在のウィンドウ内で現在フォーカスに最も近い i を指す要素へ移動する(同距離なら前方) |
| F9 | `onEndReached` は `loop` 時は発火しない(終端が存在しないため) |
| F10 | `scrollBehavior`: `stick-to-start` / `stick-to-end` をサポート。`jump-on-scroll` は非サポート(`loop` と併用時は `console.error` + 通常動作にフォールバック) |
| F11 | `orientation` horizontal / vertical 両対応、`itemSize` は数値・関数の両方をサポート |
| F12 | Pointer(Web カーソル)スクロールの矢印も無限に動作する |

### 2.2 非機能要件

- NF1: 削除(トリム)時にフォーカスを失わない・画面上の見た目がジャンプしない(アニメーションの巻き戻りが出ない)
- NF2: 仮想ノード数・描画要素数は有界(データ N 件に対して高々 数周回分)
- NF3: `loop=false` の既存コードパスで再レンダリング回数・計算量が増えない
- NF4: 既存スナップショット/テストが変更なしで通る

### 2.3 スコープ外(今回やらない)

- **逆方向(先頭より前)への無限ループ**。LRUD は子ノードを登録順で並べるため、先頭側へ仮想ノードを挿入すると順序が崩れる(§6 参照)。「左端に戻れる範囲は現在ウィンドウの先頭まで」とする
- `SpatialNavigationVirtualizedGrid` への対応
- `jump-on-scroll`
- `data` 変更時の周回位置の維持(§5.4 の簡易仕様のみ)

## 3. 現状アーキテクチャ(関連箇所)

```
SpatialNavigationVirtualizedList        (Node で包む)
 └ …WithScroll        focus index の state を保持 / ref / Pointer 矢印
    └ …WithVirtualNodes   data の各 index ごとに LRUD 仮想ノードを登録 (id は index から生成)
       └ VirtualizedListWithSize   list サイズ取得
          └ VirtualizedList        range 計算 / translate 計算 / recycled key
```

無限化に効いてくる現状の性質:

1. 位置は `index * itemSize`(可変サイズは `data.slice(0,index)` の合計)の絶対 translate。
2. スクロール量は `computeAllScrollOffsets` が `data` 全 index 分を事前計算。`stick-to-start` は `maxPossibleLeftAlignedIndex` で終端 clamp。
3. 仮想ノード id は `getNthVirtualNodeID(index)`。登録は「長さの増減」でのみ差分更新(`updateVirtualNodeRegistration`)で、**末尾追加/末尾削除しか扱えない**。
4. recycled key は `index % numberOfItemsToRender`。
5. フォーカス index は `WithScroll` の state。`remoteKeys` 時のみ更新される。

→ 「先頭を削除」すると、素朴には全 index が N ずれ、(a) translate が N*itemSize 分ジャンプ、(b) 仮想ノード id が別要素を指す → フォーカス喪失、(c) key が変わり再マウント、が起きる。これを避けるのが設計の核心。

## 4. 設計

### 4.1 方針: 絶対 index(abs)モデル

内部では周回をまたいで単調増加する **絶対 index `abs`** でリストを扱い、論理 index は `abs % N`、要素は `data[abs % N]`。

- **ウィンドウ** `[start, end)`(abs)だけが「実体化」される。`start`/`end` は常に N の倍数(周回単位)
- 位置・スクロール量・仮想ノード id・recycled key はすべて **abs 基準**
  → 先頭周回を削除しても他要素の座標・id・key は不変 → NF1 を満たす(座標の再基準化が不要)
- ユーザーの描いたイメージ(終端に先頭を追加 / 左を削除)は、ウィンドウ `end` を N 進める / `start` を N 進める操作として実現される

```
初期        abs: 0 ......... N-1
            win: [0 ,        N)

focus が末尾付近 (end - focus < lookahead)
            win: [0 ,                 2N)      ← 先頭を終端に追加

focus が N に到達(ループ先頭)
            win:          [N,         2N)      ← 1周目を削除(座標・id は不変)

さらに進むと
            win:          [N,                 3N)
```

### 4.2 追加する純関数 `getInfiniteWindow`

`helpers/getInfiniteWindow.ts`(単体テスト対象)。

```ts
type InfiniteWindow = { start: number; end: number }; // abs, end 排他, 両方 N の倍数

getInfiniteWindow({
  dataLength: N,
  focusedIndex,        // abs
  previous,            // 直前のウィンドウ(初期は {0, N})
  lookahead,           // 先読み量(item 数)
}): InfiniteWindow {
  let end = previous.end;
  while (end - focusedIndex < lookahead) end += N;   // 終端に先頭を追加(N が小さい時は複数周)
  const start = Math.max(previous.start, Math.floor(focusedIndex / N) * N);
  return start === previous.start && end === previous.end ? previous : { start, end };
}
```

- `start` は単調増加のみ(再追加すると LRUD の登録順が崩れるため)
- 変化なしの時は `previous` をそのまま返す(再レンダリング抑止)
- `N === 0` の場合は呼ばない(何も描画しない)

**lookahead の決め方**: 画面内要素数は `VirtualizedListWithSize` の `onLayout` 後でないと確定しないが、ウィンドウは上位層(登録側)で必要。そこで
`numberOfItemsToRender`(既存 `getAdditionalNumberOfItemsRendered`)を `Dimensions.get('window')` を上限サイズとして概算し、

```
lookahead = numberOfItemsToRender + max(1, onEndReachedThresholdItemsNumber)
```

とする(実サイズ ≤ window サイズなので常に安全側)。可変サイズの場合は先頭 N 件の最小サイズで割った値を使う。

**トリム条件**: フォーカスがループ側の先頭(`abs % N === 0` の周回)に入った時点で、それより左(前周)を削除する。前周の仮想ノードが残っていると、ループ先頭で左キーを押した時に前周の末尾へ移動してしまい、リスト左側の UI へ移動できなくなるため。

**既知の制約(`stick-to-end`)**: `stick-to-end` ではフォーカスが右端固定で左側に前周の要素が見えているが、トリム後は左側が空白になる(ナビゲーション上も存在しない)。`stick-to-start` では影響なし。必要なら Phase 2 で「描画のみ残す(フォーカス不可)」を検討する。

### 4.3 状態の持ち方

`SpatialNavigationVirtualizedListWithScroll` が持つ:

- `currentlyFocusedItemIndex`: 内部では **abs**(`loop=false` では従来どおり index = abs)
- `infiniteWindow`: `useState<InfiniteWindow>`

フォーカス更新ハンドラ(`setCurrentlyFocusedItemIndexCallback` と Pointer の setter)内で、**同一バッチ**で
`setFocus(abs)` と `setWindow(prev => getInfiniteWindow({... previous: prev}))` を呼ぶ。
→ フォーカスがウィンドウより先に進んだフレームが存在しない。加えて lookahead の余裕分があるので、キーリピートで先行入力が来ても未登録ノードに移動しない。

### 4.4 各層の変更

**(a) `SpatialNavigationVirtualizedListWithScroll`**
- `loop` 時は `data` から実体化した `windowData = repeat(data, (end-start)/N)` を下層へ渡す(要素参照の配列なので軽量)。`infiniteWindow.start` を `indexOffset`、`start` 周回ぶんのサイズを `startOffsetPx` として併せて渡す(`startOffsetPx = (start/N) * Σ itemSize(data[i])`)
- `ref`: `currentlyFocusedItemIndex` は `abs % N` に変換して公開。`focus/scrollTo(i)` は §2.1 F8 に従い abs へ変換
- `renderWrappedItem` の最外側で `index` を論理 index(`abs % N`)に変換してから利用者の `renderItem` を呼ぶ。内側(仮想ノード、scroll context)は abs を使う
- Pointer スクロール: 下限は `window.start`、上限は無限(`loop` 時)

**(b) `SpatialNavigationVirtualizedListWithVirtualNodes`**
- 仮想ノード登録を「長さの増減」から「**abs 範囲 `[start,end)` の差分**」に変更
  - 追加: `[prevEnd, end)` を昇順に登録 / 削除: `[prevStart, start)` を解除
  - 純関数 `updateVirtualNodeRegistrationByRange` を新設しテスト。既存の `updateVirtualNodeRegistration` は `loop=false` 用にそのまま残す(NF3/NF4)
- 初回登録 / unmount 時の解除は現在の範囲全体
- `getNthVirtualNodeID(abs)` の id 生成(`useCachedValues`)はそのまま使える
- ノード登録は `useEffect`(コミット後)。lookahead 余裕で未登録ノードへの移動を防ぐ

**(c) `VirtualizedList`**
- 追加 props(内部用): `indexOffset?: number`(`data[0]` の abs、既定 0)、`startOffsetPx?: number`(既定 0)、`loop?: boolean`
- `currentlyFocusedItemIndex` は abs。内部で `local = abs - indexOffset` に直して `getRange` / scrollOffsets 参照に使う。`renderItem` に渡す `index` は abs
- 位置: アイテムの translate に `startOffsetPx` を加算 → 周回削除後も絶対座標が不変。コンテナのサイズ(`dimensionStyle`)は `startOffsetPx + windowSize`
- スクロール量: `computeAllScrollOffsets` の各値に `-startOffsetPx` を加算
- `loop` 時に clamp を無効化:
  - `stick-to-start`: `maxPossibleLeftAlignedIndex = Infinity`(終端 clamp 解除)
  - `stick-to-end`: 先頭側の clamp(`maxPossibleRightAlignedIndex`)は「初期状態は通常リストと同じ」のため維持
  - `getRange` の終端分岐は lookahead により到達しない
- recycled key は `abs % numberOfItemsToRender` のまま → トリムで再マウントなし
- `useOnEndReached`: `loop` 時は無効

**(d) 型・公開 API**
- `SpatialNavigationVirtualizedListWithScrollProps` に `loop?: boolean` を追加
- `docs/api.md` に prop・挙動・制約を追記、example に `LoopListPage` を追加

### 4.5 エッジケース

| ケース | 扱い |
| --- | --- |
| `N === 0` | 何も描画しない。ノード登録なし |
| `N < 画面内要素数` | `lookahead` ループで複数周回ぶん実体化され、画面が埋まる |
| `N === 1` | 同一要素を繰り返す。`focus` 移動は abs が進む |
| 先頭方向へ戻る | ウィンドウ先頭(`start`)で止まる。初期状態では `start = 0` なので通常リストの先頭と同じ |
| `ref.focus(i)`(ウィンドウ外相当) | F8 により常にウィンドウ内の候補へ解決 |
| mouse/pointer でフォーカス | 既存どおり `remoteKeys` 時のみ index 更新。pointer 時は `ref`/矢印経由 |
| 巨大な abs(座標精度) | 下記リスク参照 |

### 4.6 `data` が変化した場合(簡易仕様)

`data.length` が変わったら、無限モードでは内部状態をリセット: ウィンドウを `{0, N'}`、フォーカスを `abs % N'` に再設定し、仮想ノードを全解除→再登録する(`key` による再マウントで実装)。同一長での参照変更のみなら何もしない。周回位置の維持は将来課題。

## 5. テスト計画

1. `getInfiniteWindow`: 初期、end 追加境界(`end - focus === lookahead`)、start 単調性、N が小さい複数周追加、変化なし時の参照同一性
2. `updateVirtualNodeRegistrationByRange`: 追加のみ / 削除のみ / 両方 / 変化なし(登録順の昇順を検証)
3. `VirtualizedList`:`indexOffset`/`startOffsetPx` 指定時に、トリム前後で同一 abs の item の translate と scroll offset の合計が不変(ジャンプなし)
4. コンポーネント(`SpatialNavigationVirtualizedList.test.tsx` 流儀): `loop` で N+数回フォーカス移動し、①論理 index が循環 ②`renderItem` に論理 index が渡る ③フォーカスが外れない ④2周目移行後にノード数が有界
5. 回帰: `loop` 未指定のスナップショット・既存テストが無変更で通る
6. 手動(example): horizontal/vertical × `stick-to-start`/`stick-to-end`、可変サイズ、`N` が小さいケース、キー長押し

## 6. リスク・未決事項

| # | 内容 | 現時点の方針 |
| --- | --- | --- |
| R1 | 座標が単調増加。Web では数千万 px で精度劣化 | 実用上は十分遠い(例: 200px × 16万要素)。必要なら N の倍数ぶんの「アニメ無しの再基準化」を Phase 2 で追加 |
| R2 | 逆方向の無限ループ | LRUD の子の順序が登録順のため先頭への挿入ができない。`registerNode` に挿入位置指定があるか要調査(Phase 2) |
| R3 | 可変 `itemSize` の offset 計算が O(ウィンドウ長²) | 無限モードでは周回単位の累積サイズをキャッシュして O(1) 化(実装時に最適化) |
| R4 | `numberOfItemsToRender` の概算が実測より大きく、実体化が過剰 | 影響は数件分の描画のみ。許容 |
| R5 | `stick-to-end` でトリム後に左側が空白になる | 上記「既知の制約」。描画のみ残す案を Phase 2 で検討 |
| R6 | prop 名 | `loop` に決定 |

## 7. 実装ステップ

1. `getInfiniteWindow`・`updateVirtualNodeRegistrationByRange` + 単体テスト
2. `VirtualizedList` に `indexOffset` / `startOffsetPx` / `loop` を追加(既定値で既存挙動不変)+ テスト
3. `WithVirtualNodes` の登録を範囲差分に対応
4. `WithScroll` で abs/論理 index 変換・ウィンドウ state・ref・Pointer 対応
5. 型・`docs/api.md`・example ページ
6. 手動確認(TV/Web)と調整
