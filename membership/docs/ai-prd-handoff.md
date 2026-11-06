# 给 AI PRD 同事的接入交接

无需交出完整源码。线上地址用于核对界面，以下服务端能力需在 AI PRD 仓库实现。当前联合套餐不可售卖。

1. 沿用 AI PRD 自己的中心账号登录，服务端取可信 centralUserId，不接受浏览器传入的用户 ID。
2. 同源 GET /api/union-membership 代理会员服务 offer。所有认证用户首次进入产品时调用 offer 入组，A 组和未配置服务隐藏全部新增入口。付费墙在单品套餐后、加量包前挂载 widget，账号菜单使用 placement=account。
3. 按 product-integration.md 及 product-adapter.mjs 实现 snapshot/activate/extend/grant/revoke/restore，接入真实功能权限和 AI 积分。冻结原订阅时间与未用套餐积分，独立加购积分保留，高档继承只作用 AI PRD。
4. 将 SDK 表结构纳入 AI PRD 迁移，每个 hook、原生变更和幂等记录在同一事务。购买与支付履约均拦截冲突单品订阅，先确认停止自动续费及处理待支付订单。
5. 提供审核后的个人专业档月卡/年卡功能、积分、刷新与过期规则；有高档继承时提供高档映射。补入 config/catalog.json 新版本，不能仅凭页面文案填写额度。
6. 原生支付/退款/成本/核心任务成功写本地 outbox，使用原始发生时间，稳定事件 ID 重试。缺少成本发 cost_unavailable，仅打开页面不算有效使用。
7. 在测试环境验证免费/标准/高档、加购、续期、到期、部分失败、退款、重复回调与 A 组直接链接拦截，再提供测试接口前缀及独立服务间凭证。凭证通过安全渠道配置，不写进交接包或前端。

文档：docs/product-integration.md。实现模板：integrations/product-adapter.mjs、client.mjs、outbox.mjs。组件：public/widget.js。
