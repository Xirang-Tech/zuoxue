# 产品接入说明：联合会员

适用于 AI PRD 同事接入，以及其余产品后续的真实计费接入。线上链接只能用于核对界面；权益变更必须由对应产品服务端完成。

## 已接入与仍需接入

课伴、AI PM 作品集、Vibe Workflow、产品范式本地源码已添加卡片、菜单入口、首个认证会话入组与同源 `/api/union-membership` 代理；未配置服务时返回隐藏，不影响原购买流程。Vibe Workflow 沿用 Bearer API 包装，其他产品沿用各自 Cookie/认证适配。

**所有产品还需要把下面的事务适配器接到真实账本，并接入可靠收支和核心任务事件。** 当前没有直接改写产品原有订阅、已购额度、历史项目或生产数据库。

## 1. 账号与展示

复制 `integrations/client.mjs` 到产品服务端，按需复制声明文件。创建专用产品凭证并配置：

```text
UNION_MEMBERSHIP_URL=https://member.zuoxue.com
UNION_MEMBERSHIP_TOKEN=<该产品独立的服务间凭证>
```

认证完成后，从已验证的本地用户记录取 `centralUserId`，调用 `client.offer(centralUserId, baselineStatus)`。`baselineStatus` 应为真实会员状态的粗粒度标签，如 `free/pro/max`；不能从浏览器接收中心账号，也不能用本地用户 ID 代替。

同源 `GET /api/union-membership` 返回此结果，禁止公共缓存。匿名用户返回 401 或隐藏状态。即使会员中心不可用，也保持原产品可用并隐藏新促销。

把 `public/widget.js` 放入产品前端，或使用已附的 React 包装：

```js
const unmount = mountUnionOffer(element, {
  productId: 'aiprd',
  placement: 'paywall',
  endpoint: '/api/union-membership',
});
```

放在会员套餐之后、积分加购之前；账号菜单使用 `placement: 'account'`。卸载时执行 `unmount()`。对 Bearer 产品传入原有认证 `fetcher`。返回地址只保留任务定位参数，不携带用户正文、密码或 token。

付费墙 Banner 不显示价格或额度明细，只展示真实 Logo、产品名称与会员档位；价格和完整额度在会员中心查询。同步 `public/union-media/` 下的 SVG 和 WebP 到产品的同名公开目录，不能只复制组件。课伴、AI PM 和 Workflow 按 `productId` 使用各自样式；产品范式沿用原生 React 组件。Workflow 仅放在创作点数面板的三档套餐下方、单次补充上方。素材不依赖会员中心跨域加载。

营销事件转发到 `client.event()`。`core_task_completed` 只能由产品服务端确认成功后发送，不能由浏览器上报。

## 2. 产品端权益接口

复制 `integrations/product-adapter.mjs`；用本产品正常迁移机制应用 `PRODUCT_ADAPTER_SCHEMA`，不能在请求时临时创建表。每个请求均校验专用 `Authorization: Bearer` 凭证。对外路由：

```text
POST /internal/union-membership/snapshot
POST /internal/union-membership/activate
POST /internal/union-membership/extend
POST /internal/union-membership/grant
POST /internal/union-membership/revoke
POST /internal/union-membership/restore
```

向会员服务配置的适配器 URL 为以上路径前缀。课伴使用 Next.js 路由，前缀为 `/api/internal/union-membership`；其他三个本地产品为 `/internal/union-membership`。入口调用 `adapter.handle(action, body, suppliedToken)`，不要将这些接口放在用户端开放权限下。

适配器需要本产品数据库的 `query(sql, values)` 和 `transaction(async tx => ...)`，及以下 hooks。每个 hook 与幂等操作记录、冻结快照在**同一个产品数据库事务**中提交：

| hook | 必须实现的真实账本行为 |
| --- | --- |
| `read(tx, centralUserId, now)` | 锁定原生订阅/账户行，读取当前档位、剩余时间、未消费套餐额度、自动续费及未结算任务；返回可持久化的 `frozen` 快照 |
| `pause(tx, current, body, now)` | 停止原订阅时间和套餐额度消耗；不改变单独加购额度与永久项目 |
| `install(tx, current, body, now)` | 安装 `effectiveTierId` 的功能权限，使用传入有效期；不要自动额外赠送另一份标准套餐额度 |
| `grant(tx, record, body, now)` | 根据 `operationId/orderId/planId/unit/amount/at/expiresAt` 发放可被原有扣费逻辑实际消费的额度；按传入周期核对额度，不可只写展示余额 |
| `extend(tx, record, body, now)` | 按最新 revision 设置有效期；不刷新当前额度。退款时可能缩短有效期 |
| `revoke(tx, record, body, now)` | 撤回指定联合订单尚未使用的额度与待发额度，不返还已消费额度，不影响其他订单 |
| `restore(tx, record, body, now)` | 从本地真实冻结快照恢复原档位、剩余时长及原未用套餐额度；不覆盖联合期间已使用或新购的独立加量包 |

`read` 的对外字段示例（具体数字须取真实账本）：

```json
{
  "ready": true,
  "tierId": "pro",
  "tierName": "专业版",
  "tierRank": 1,
  "remainingMs": 0,
  "remainingQuota": { "credits": 0 },
  "autoRenewActive": false,
  "pendingReservations": 0,
  "pendingSubscriptionOrder": false,
  "snapshotVersion": "原生账本版本"
}
```

`autoRenewActive`、`pendingReservations`、`pendingSubscriptionOrder` 必须明确返回，未知不能当作已取消或零。原始 `frozen` 数据只存在本产品数据库，适配器会从对外快照里移除。

有更高档且仍有效时，再返回 `highTierVerified: true` 和已审核 `highTierGrants`，按月卡/年卡分别列出额度；高档免费继承只发生于该产品。年度继承的全部成本须纳入核算。

`verified` 默认保持 false。只有所有 hooks、真实额度消耗、老会员恢复和财务埋点联合验收后，才能开启。

还需在原生订阅的**创建和支付履约事务**中调用 `assertStandaloneSubscriptionAllowed(tx, centralUserId)`，阻止联合期间出现冲突订阅；独立加量包不受此限制。冻结前存在待支付订阅订单时应阻止开通，先核对关闭原订单。

用户尚未访问本产品时，应按本产品既有中心账号映射流程安全创建或惰性绑定本地账户；不得静默替换已有业务用户、按邮箱直接合并数据或返回虚假的开通成功。

## 3. 可靠事件与收入

复制 `integrations/outbox.mjs`，通过产品迁移添加 `OUTBOX_SCHEMA`。在原生支付、退款、成本入账或核心任务成功的同一事务调用 `enqueueUnionTelemetry()`；后台任务用 `flushUnionTelemetry(db, client)` 重试。

收支 payload：

```json
{ "id": "不可重复的原生事件ID", "orderId": "原生订单ID", "kind": "payment", "amountCents": 0, "occurredAt": 0, "isTest": false }
```

`kind` 为 `payment/refund/cost`。同一订单多笔退款、费用必须有不同的稳定事件 ID。核心任务 payload 为 `name: core_task_completed` 和静态 `operation/outcome` 标签；不采集文档正文、简历、需求输入或 AI 输出。

缺少模型 usage、汇率、供应商成本或共享转写分摊时，上报服务端事件 `cost_unavailable`。缺少成本不能当零成本；报告展示缺口，并在缺口或清单未审核时将贡献毛利标为不可用。事件传入原始 `occurredAt`，重试不能改成发送时间。

交易成功以服务端确认结果为准。接口未配置或发送失败时，outbox 保留，不能把失败当作已送达。测试账号通过服务间配置标记，测试订单必须 `isTest=true`。

## 4. 必须通过的联合验收

- 同一个中心账号在所有产品、设备上分组一致，A 组无法通过直接链接下单。
- 标准档和高档老会员冻结后不能被继续扣减，恢复后保持原剩余量；独立加量包按原规则消耗。
- 并发任务与冻结串行执行；事务中断不能出现“旧权益已冻结，新权益没安装”。
- 回调、额度发放和恢复重复调用不重复增加；相同幂等 ID 不接受不同金额或额度。
- 年卡按已审核清单逐期发放；课伴原生全年额度按 upfront 发放。提前续期不刷新当前周期，不产生第 13 次月度发放。
- 一款产品失败时会员中心显示开通中；额度没到账不能显示全部完成。
- 退款原生账本与联合服务账本一致，停止售卖后继续为已购用户服务。
- 五款单品收入、退款和有效任务全部进入实验账本；缺一款数据时不启动正式 A/B 统计。

联合会员服务已附带事务适配器和 outbox 的隔离数据库测试，产品方应以自己的原生数据模型再运行相同场景。通过前保持真实售卖关闭。

## 产品范式已实现的参考

最新实现位于 `../../worktrees/pattern-union/server/union/`，包含原生账本 hooks、可靠事件和验证说明。项目包每期 3 个，最多累计 6 个，grant 使用 `validity: membership`；工具每期 30 次，使用 `validity: period`。`validity` 省略时默认按发放周期过期。继承产品自身累计上限仍由产品 hook 执行。

outbox 的事件时间使用写入原生成功事务时的 `created_at`，重试不改写核心任务发生日期，防止离线重传移出 7 天观察窗。
