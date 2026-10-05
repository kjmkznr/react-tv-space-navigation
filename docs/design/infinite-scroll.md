# SpatialNavigationVirtualizedList 無限ループスクロール(`loop`)— 要件定義 / 設計

ステータス: 実装済み(実装時の差分は末尾「実装メモ」を参照)

## 1. 背景と目的

`SpatialNavigationVirtualizedList` は有限の `data` を前提にしており、端に到達するとそれ以上進めない。
カルーセル型 UI 向けに、**データを繰り返し表示する無限ループスクロール**を `loop` prop で追加する。

イメージ:

- 初期状態は通常のリストと同じ見た目
- フォーカスは画面上の固定位置
- 終端に到達しそうになったら、データの先頭を終端に追加する(先頭方向も同様)
- 遠く離れた周回の要素は削除し、描画要素・LRUD ノードを有界に保つ

## 2. 要件

### 2.1 機能要件

| ID | 要件 |
| --- | --- |
| F1 | `loop` prop(既定 `false`)を追加。`false` の時は現行挙動・コードパスと完全に同一(後方互換) |
| F2 | `loop=true` の初期表示は通常のリストと同一(先頭要素から表示)。ただし先頭方向のループのため、画面外には前周の要素が既に実体化されている |
| F3 | フォーカスが前方の端に近づいたら(lookahead)次の周回(= `data` 全体)を終端に追加する。ユーザーには途切れなく続いて見える |
| F4 | 同様に、後方の端に近づいたら(lookbehind)前の周回を先頭に追加する(**先頭方向のループ**。先頭要素で戻る操作は末尾要素へ移る) |
| F5 | フォーカスから十分離れた周回は削除する。実体化される周回数・仮想ノード数は有界 |
| F6 | フォーカスは固定位置のまま。端での clamp(スクロール停止)は起きない |
| F7 | `data` が画面に収まらない長さ(例: 3件で画面に8件分)でも、繰り返しで画面が埋まる(初期ウィンドウもこの要件を満たすこと) |
| F8 | `renderItem` / `ref.focus` / `ref.scrollTo` / `ref.currentlyFocusedItemIndex` に露出する index は常に **論理 index(0〜N-1)**。非推奨の `keyExtractor` には絶対 index を渡す |
| F9 | `ref.focus(i)` / `scrollTo(i)` は、現在のウィンドウ内で現在フォーカスに最も近い i を指す要素へ移動する(同距離なら前方) |
| F10 | `onEndReached` は `loop` 時は発火しない |
| F11 | `scrollBehavior` は **`stick-to-start` のみ対応**。`stick-to-end` / `jump-on-scroll` と併用された場合は `console.error` を出し、`loop` を無視して通常動作にフォールバックする |
| F12 | `orientation` horizontal / vertical 両対応、`itemSize` は数値・関数の両方をサポート |
| F13 | Pointer(Web カーソル)スクロールの矢印も両方向に無限に動作する |
| F14 | リスト外へのフォーカス移動(左右の別 UI など)は LRUD のフォーカス管理に任せる。ループ側で特別な処理はしない(`loop` では前後の周回が常に存在するため、リスト内の左右キーは常にリスト内要素へ移る) |

### 2.2 非機能要件

- NF1: ウィンドウ更新(追加・削除)でフォーカスを失わない。画面上の見た目がジャンプしない(アニメーションの巻き戻りが出ない)
- NF2: 仮想ノード数・描画要素数・id キャッシュは有界
- NF3: `loop=false` のコードパスで再レンダリング回数・計算量が増えない
- NF4: 既存スナップショット/テストが変更なしで通る
- NF5: ウィンドウ更新時の再計算は `O(ウィンドウ長)`(固定サイズでは offset 計算を O(1) 化)

### 2.3 スコープ外

- `SpatialNavigationVirtualizedGrid` への対応
- `stick-to-end` / `jump-on-scroll`
- `data` 変更時の周回位置の維持(§4.7 の簡易仕様のみ)

## 3. 現状アーキテクチャ(関連箇所)

```
SpatialNavigationVirtualizedList        (Node で包む)
 └ …WithScroll        focus index の state を保持 / ref / Pointer 矢印
    └ …WithVirtualNodes   data の各 index ごとに LRUD 仮想ノードを登録 (id は index から生成)
       └ VirtualizedListWithSize   list サイズ取得
          └ VirtualizedList        range 計算 / translate 計算 / recycled key
```

無限化に効いてくる現状の性質(レビューで検証済み):

1. 位置は `index * itemSize`(可変サイズは `data.slice(0,index)` の合計)の絶対 translate。
2. スクロール量は `computeAllScrollOffsets` が `data` 全 index 分を事前計算。`stick-to-start` は `maxPossibleLeftAlignedIndex` で終端 clamp。
3. 仮想ノード id は `getNthVirtualNodeID(index)`。登録は「長さの増減」でのみ差分更新(`updateVirtualNodeRegistration`)で、末尾追加/末尾削除しか扱えない。id は `useCachedValues` が index ごとに永続キャッシュする。
4. recycled key は `index % numberOfItemsToRender`。
5. フォーカス index は `WithScroll` の state。`onFocus` 経由では `remoteKeys` 時のみ更新、`ref.focus` と Pointer 矢印は直接更新する。
6. LRUD(`@bam.tech/lrud` 8.0.2)は `registerNode` の `index` オプションで子の挿入位置を指定でき、以降の兄弟の index を詰め直す。`SpatialNavigator.registerNode` は引数をそのまま lrud に渡す。**→ 先頭への挿入が可能**。

素朴に配列の先頭を増減すると全 index がずれ、translate のジャンプ、仮想ノード id のずれ(フォーカス喪失)、key 変更による再マウントが起きる。これを避けるのが設計の核心。

## 4. 設計

### 4.1 方針: 絶対 index(abs)モデル

内部では周回をまたいで単調に定義される **絶対 index `abs`**(負値も可)でリストを扱う。論理 index は `((abs % N) + N) % N`、要素は `data[論理 index]`。

- **ウィンドウ** `[start, end)`(abs)だけを実体化する。`start`/`end` は常に N の倍数(周回単位)
- 位置・スクロール量・仮想ノード id・recycled key は **abs 基準**
  → 追加・削除しても他要素の座標・id・key は不変(NF1)
- `stick-to-start` の変位は `-abs * itemSize`(ウィンドウ構成に依存しない)なので、ウィンドウ更新で変位の値は変わらず、`Animated.timing` / CSS transition は発火しない(レビューで確認済み)

```
初期 (focus=0)          abs: -N ....... 0 ....... N-1 ....... 2N-1
                        win: [-N,                           2N)   ※ lookahead/lookbehind を満たす最小周回数

前方へ進む              win:      [0,                       3N)   ← 先頭を終端に追加 / 最古の周回を削除
後方へ戻る              win: [-N,                           2N)   ← 前周を先頭に挿入 / 最新の周回を削除
```

### 4.2 純関数 `getLoopWindow`

`helpers/getLoopWindow.ts`(単体テスト対象)。ウィンドウは **フォーカスの関数** として決まるが、境界での出入りの揺れ(ヒステリシス)を避けるため `previous` を使う。

```ts
type LoopWindow = { start: number; end: number }; // abs, end 排他, 両方 N の倍数

getLoopWindow({ dataLength: N, focusedIndex, previous, lookahead, lookbehind }): LoopWindow {
  // 必要な範囲(拡張)
  let start = previous?.start ?? 0, end = previous?.end ?? 0;
  const needStart = focusedIndex - lookbehind, needEnd = focusedIndex + lookahead + 1;
  while (start > needStart || start === end) start -= N;       // 先頭に前周を追加
  while (end < needEnd) end += N;                              // 終端に先頭を追加
  // 不要な範囲(削除): 1周以上離れた周回のみ。必要範囲を割らない
  while (start + N <= needStart) start += N;
  while (end - N >= needEnd) end -= N;
  return same(previous) ? previous : { start, end };
}
```

- 初期値は `useReducer` の init 関数で `getLoopWindow({focus: 0, previous: undefined, …})` を呼ぶ(N が小さくても初回描画で画面が埋まる = F7)
- 「必要範囲を 1 周分以上外れた周回のみ削除」なので、境界付近の往復で追加・削除が連続して起きない
- 変化なしなら `previous` を返す(再レンダリング抑止)
- `N === 0` は呼ばない(何も描画しない)

**lookahead / lookbehind** は `numberOfItemsToRender`(既存 `getAdditionalNumberOfItemsRendered`)+ 余裕分とする。初期値は `Dimensions.get('window')` から概算するが、`VirtualizedList` が実際に使った `numberOfItemsToRender` をコールバック(`onRenderedItemsCountChange`)で上位に通知し、`max(概算, 実測)` で更新する(画面より大きい vertical リスト等で概算が不足するのを防ぐ)。

### 4.3 状態の持ち方(`useReducer`)

`SpatialNavigationVirtualizedListWithScroll` に `{ focusedIndex(abs), window }` を **1つの reducer** で持つ。

- アクション: `focus(abs)`(onFocus / Pointer / `ref.focus`)、`setLookahead(...)`、`reset(N)`
- 1アクションでフォーカスとウィンドウを同時に更新 → フォーカスがウィンドウより先に進むフレームがない。Pointer 経路は現在の state を reducer が受けるので、updater 内で次 index を決めて `grabFocus` する既存処理も整合する
- **ウィンドウを動かすのは「実際に確定したフォーカス変更」のみ**。`ref.focus(i)` は(F9 により)現在のウィンドウ内の abs を解決して `grabFocusDeferred` する。要求しただけでウィンドウは動かさない → 旧フォーカスのノードが先に解除され lrud が任意の子へフォーカスを移す事故(`recalculateFocus`)を避ける。ウィンドウ削除は「1周以上離れた周回」のみなので、確定したフォーカスを含む周回は消えない

### 4.4 各層の変更

**(a) `WithScroll`**
- `loop` 時は `windowData = repeat(data, (end-start)/N)` を下層へ渡す。併せて `indexOffset = start` と `startOffsetPx`(= `start` 周回ぶんのサイズ。固定サイズは `start * itemSize`、可変サイズは `(start/N) * Σ itemSize`。負も可)を渡す
- `ref`: `currentlyFocusedItemIndex` は論理 index に変換して公開。`focus/scrollTo(i)` は F9 に従い abs へ変換
- `renderWrappedItem` の最外側で index を論理 index に変換してから利用者の `renderItem` を呼ぶ。内側(仮想ノード、scroll context)は abs
- Pointer: 下限・上限とも無限(`loop` 時)

**(b) `WithVirtualNodes`**
- 仮想ノード登録を「長さの増減」から「**abs 範囲 `[start,end)` の差分**」に変更。純関数 `updateVirtualNodeRegistrationByRange` を新設しテスト
  - 後方追加 `[prevEnd, end)`: 昇順に登録(`index` 省略 = 末尾)
  - **先頭追加 `[start, prevStart)`**: 昇順に、`index: 0, 1, 2, …` を指定して登録(lrud が兄弟の index を詰め直すので順序が保たれる)
  - 削除: 範囲外になった abs を解除(解除順は親→子の順序問題なし。子の解除は `getNode` が無いだけで no-op)
- 既存の `updateVirtualNodeRegistration` は `loop=false` 用にそのまま残す(NF3/NF4)
- ノード id のキャッシュ(`useCachedValues`)は、`loop` 時は解除時にエントリも削除して有界に保つ(NF2)

**(c) `VirtualizedList`**
- 追加 props(内部用): `indexOffset`(`data[0]` の abs、既定 0)、`startOffsetPx`(既定 0)、`loop`、`onRenderedItemsCountChange`
- **abs と local の使い分け**: `currentlyFocusedItemIndex` と `renderItem`/key に渡す `index` は abs。`getRange`・scrollOffsets 配列の参照・`ItemContainer` の offset 計算(`data.slice(0, index)`)は local(= abs - indexOffset)で行い、可変サイズでは `+ startOffsetPx` を足す。固定サイズは `abs * itemSize` で直接求まる
- スクロール量: `computeAllScrollOffsets` の各値に `-startOffsetPx` を加算
- `loop` 時は終端 clamp(`maxPossibleLeftAlignedIndex`)を `Infinity` にして無効化。`getRange` の端処理は lookahead/lookbehind により到達しない。`stick-to-end` は非対応(F11)なので先頭側 clamp の問題は生じない
- コンテナ寸法(`dimensionStyle`): アイテムは abs 座標(負も含む)に置かれるため、`[startOffsetPx, startOffsetPx + windowSize]` を覆うように幅/高さと位置を調整する。**負座標のアイテムが各プラットフォームで描画されること(overflow visible)を Phase 0 のスパイクで確認する**
- recycled key `abs % numberOfItemsToRender` は負の abs で負値になるため `((abs % k) + k) % k` に変更(`loop` 時のみ。レビューでは key 衝突なしを確認済み)
- 計算量(NF5): `getSizeInPxFromOneItemToAnother` の `slice` を固定サイズでは算術に置き換える。可変サイズは windowData ごとに累積和配列を1回作って参照する。`getNumberOfItemsVisibleOnScreen` はメモ化する
- `useOnEndReached`: `loop` 時は無効

**(d) 型・公開 API**
- `SpatialNavigationVirtualizedListWithScrollProps` に `loop?: boolean` を追加
- `docs/api.md` に prop・挙動・制約(`stick-to-start` のみ)を追記、example に `LoopListPage` を追加

### 4.5 エッジケース

| ケース | 扱い |
| --- | --- |
| `N === 0` | 何も描画しない。ノード登録なし |
| `N < 画面内要素数` | `getLoopWindow` が複数周回ぶん実体化し、画面が埋まる(初期ウィンドウから) |
| `N === 1` | 同一要素を繰り返す。focus 移動は abs が進む(左右の移動先は隣の複製) |
| 先頭要素から戻る | 前周の末尾要素へ移る(F4) |
| リスト外(左右の別 UI)へ出る | リスト内に常に隣接要素があるため、通常はリスト外へは出ない。上下など直交方向の移動は LRUD に任せる(F14) |
| `scrollBehavior` が非対応 | `console.error` + `loop` 無視(F11) |
| `keyExtractor`(非推奨) | abs を渡す(論理 index だと N が小さい時にキーが重複する) |
| 座標の精度 | §6 R1 |

### 4.6 フォーカス喪失対策のまとめ

- ウィンドウ削除は「必要範囲から 1 周以上離れた周回」のみ。確定したフォーカスを含まない
- `ref.focus` はウィンドウ内の abs だけを対象にし、ウィンドウを先に動かさない
- ウィンドウ更新は reducer 1 アクションで同一バッチ

### 4.7 `data` が変化した場合(簡易仕様)

`data.length` が変わったら、`reset(N')` アクションでウィンドウを再計算し、フォーカスを `abs % N'`(論理 index を維持、範囲外は 0)に設定する。仮想ノードは一旦全解除→再登録し(`key` による再マウント)、**再マウント後に `grabFocusDeferred(id(復元した abs))` でフォーカスを取り直す**(一括解除中に lrud が別ノードへフォーカスを移すため)。同一長での参照変更のみなら何もしない。

## 5. テスト計画

1. `getLoopWindow`: 初期、前方/後方の拡張境界、削除は 1 周以上離れた時のみ、N が小さい時の複数周、ヒステリシス(往復で揺れない)、変化なし時の参照同一性、負の abs
2. `updateVirtualNodeRegistrationByRange`: 後方追加 / 先頭追加(`index: 0..` が付与される)/ 削除 / 両方 / 変化なし
3. `VirtualizedList`: `indexOffset`/`startOffsetPx` 変更前後で、同一 abs の要素の位置とスクロール変位が不変(ジャンプなし)。負の abs の recycled key
4. コンポーネント(`SpatialNavigationVirtualizedList.test.tsx` の流儀):
   - 前方に N+数回移動 → 論理 index が循環、`renderItem` に論理 index が渡る、フォーカスが外れない、ノード数が有界
   - 先頭から戻る → 末尾要素へフォーカスが移る
   - `ref.focus(i)` / Pointer 矢印の経路でフォーカスを失わない
   - `data.length` 変更後にフォーカスが復元される
   - `stick-to-end` + `loop` で `console.error` され通常動作になる
5. 回帰: `loop` 未指定のスナップショット・既存テストが無変更で通る
6. 手動(example): horizontal/vertical、可変サイズ、`N` が小さいケース、キー長押し

## 6. リスク・未決事項

| # | 内容 | 方針 |
| --- | --- | --- |
| R1 | abs 座標が周回数に応じて増える。float32 は約 1677 万 px、Blink の LayoutUnit は約 3355 万 px で劣化 | 実用上は到達しにくい(200px × 8 万要素)。必要なら N の倍数ぶんの「アニメ無し再基準化」を Phase 2 で追加 |
| R2 | 負座標のアイテムの描画・コンテナ寸法 | Phase 0 のスパイクで web / native を確認。問題があれば固定の正のオフセット(大きな N の倍数)を全座標に足す |
| R3 | lookahead 概算の誤差 | 実測の `numberOfItemsToRender` を通知して `max` を取る(§4.2) |
| R4 | `lrud` の `index` 挿入と focus 状態(`activeChild`)の相互作用 | 先頭追加時に `activeChild` が変わらないことを統合テストで確認(Phase 0) |
| R5 | `stick-to-end` 非対応 | 将来対応する場合は、abs 基準の先頭 clamp と、描画のみ残す削除戦略が必要(今回はスコープ外) |

## 7. 実装ステップ

0. スパイク: 負座標の描画(R2)、lrud の `index` 挿入と `activeChild`(R4)を example で確認
1. `getLoopWindow`・`updateVirtualNodeRegistrationByRange` + 単体テスト
2. `VirtualizedList` に `indexOffset` / `startOffsetPx` / `loop` / 通知コールバックを追加(既定値で既存挙動不変)+ テスト
3. `WithVirtualNodes` の登録を範囲差分(先頭挿入含む)に対応、id キャッシュの有界化
4. `WithScroll` で reducer、abs/論理 index 変換、ref・Pointer 対応、`data` 変更時の reset
5. 型・`docs/api.md`・example ページ
6. 手動確認(TV/Web)と調整

## 付録: レビュー反映履歴

- 敵対的レビュー(別モデルによる実コード検証)で、`stick-to-end` のトリム時逆スクロール(B1)・表示消失(B2)、lrud の登録順前提の誤り(M1)、`ref.focus` 経由でのフォーカス喪失(M2)、state 同期(M3)、初期ウィンドウ(M4)、`data` 変更時のフォーカス(M5)、lookahead 概算(m1)、計算量(m2)、id キャッシュ(m3)、`keyExtractor`(m4)、abs/local の混同(m5)、精度(m6)、フォールバック(m7)が指摘された
- 決定: `stick-to-end` は非対応(B1/B2/m7 解消)、リスト外へのフォーカス移動は LRUD に任せる(F14)、先頭方向のループは対応(M1 を踏まえ lrud の `index` 挿入を利用)
- その他は本版で反映

## 実装メモ(設計からの差分)

- 初回フォーカス: `DefaultFocus` は「最初に描画された focusable」にフォーカスを与えるため、ループ時は先頭に前周の要素が描画され、abs=-2 などが先にフォーカスされてしまう。対策として (1) ループ時の各アイテムを `DefaultFocus enable={親の設定 && abs === 0}` で包む、(2) 初回登録は abs ≥ 0 を先に登録し、abs < 0 は `index` 指定で先頭に挿入する、(3) `SpatialNavigator.setActiveChild(parentId, childId)` を追加し、abs=0 の仮想ノードを activeChild にする(未登録なら登録時に遅延適用)
- 仮想ノード id: ループ時は `useCachedValues` を使わず `${prefix}_${abs}`(区切りの `_` が必須。`uniqueId` の末尾が数字のため)
- 可変サイズの offset / 全周回のサイズは `computeLoopItemOffsets` で 1 パス計算
- `data.length` の変更は render 中に `reset` を dispatch し(ウィンドウとデータの不整合を作らない)、変更後に `grabFocusDeferred` でフォーカスを取り直す
- スコープ外のまま: 座標の再基準化(R1)、`stick-to-end`
- 未確認: 実機(native / web)での負座標アイテムの描画(R2)。jest(react-native-testing-library)では検証済みだが、ブラウザ・実機での目視確認は未実施
