# 四款产品联合会员 Banner 验收

日期：2026-11-06。本次仅本地界面落地，没有发布生产、修改身份服务、创建真实订单或发放权益。

## 视觉证据

已确认视觉稿位于 `output/banner-real-logos/`，实际浏览器截图及对照位于 `output/banner-implementation/`。所有截图来自 Codex 内置浏览器，不以构建结果代替页面检查。

| 产品 | 来源 Banner 像素 | 实际桌面 Banner 像素 | 桌面对照 | 390px 手机截图 |
| --- | --- | --- | --- | --- |
| 课伴 | 1145 × 377 | 1040 × 352 | [完整对照](output/banner-implementation/keban-comparison.png) | [手机页面](output/banner-implementation/keban-mobile.jpg) |
| AI PM 作品集 | 1298 × 402 | 1088 × 406 | [完整对照](output/banner-implementation/aipm-comparison.png) | [手机页面](output/banner-implementation/aipm-mobile.jpg) |
| Vibe Workflow | 1363 × 509 | 1024 × 437 | [完整对照](output/banner-implementation/workflow-comparison.png) | [手机面板](output/banner-implementation/workflow-mobile.jpg) |
| 产品范式 | 1334 × 383 | 1080 × 363 | [完整对照](output/banner-implementation/pattern-comparison.png) | [手机页面](output/banner-implementation/pattern-mobile.jpg) |

桌面浏览器视口为 1487 × 1058 CSS px，手机视口为 390 × 844 CSS px，截图密度为 1。Workflow 在真实点数弹窗内检查：桌面内容宽 1024px、手机内容宽 349px。为消除参考稿与真实产品内容区宽度的差异，对照图将各自 Banner 等比缩放到 700px 宽，并排比较，未拉伸高度。

五款 Logo、名称和档位单独放大对照：

- [课伴局部](output/banner-implementation/keban-focus-comparison.png)
- [AI PM 局部](output/banner-implementation/aipm-focus-comparison.png)
- [Workflow 局部](output/banner-implementation/workflow-focus-comparison.png)
- [产品范式局部](output/banner-implementation/pattern-focus-comparison.png)

## 检查与迭代

1. 初次检查发现课伴中等桌面宽度过早改成底部按钮，偏离已选构图；已调整切换阈值，桌面恢复右侧按钮。再次截图 `keban-desktop.jpg` / `keban-comparison.png` 确认。
2. [P2，已修复] AI PM 产品标签过宽，遮挡了插画下方的产品标识。标签区域收紧为左侧 55%，插画改为右侧独立区域；再次截图 `aipm-desktop.jpg` / `aipm-comparison.png`，五个插画标识与产品列表不再相互遮挡。
3. [P2，已修复] 产品范式全站规则清除了背景渐变，导致页面偏灰。改为暖米色实底，保留原有全站规则；再次截图 `pattern-desktop.jpg`、`pattern-mobile.jpg` 确认。
4. 窄屏检查确认三款共享组件及产品范式均使用两列，最后一项占满一行。Workflow 横向连接线隐藏。四款 Banner 无横向溢出，页面宽度均为 390px。

### 五项设计检查

- 字体与排版：课伴、AI PM 沿用产品无衬线字体；Workflow、产品范式沿用原生衬线字体。名称、档位未截断，Logo 与文字对齐。
- 间距与布局：四种风格、圆角与方角区别保留；真实页面内容区较参考稿窄，采用响应式字号与间距，不承诺整张页面逐像素一致。
- 配色与视觉变量：浅紫、深紫、黑白、暖米棕四种配色区分明确；按钮、边框与原页面协调。
- 图片与品牌：40 份 SVG（四个原仓库、四个联调副本各五份）均逐字节匹配已核实原素材。插画来自已选视觉稿局部，未把完整 Banner 栅格化，也没有重绘 Logo。
- 内容：产品当前项排第一；只显示名称和档位，不出现价格、价格待公布、演示价格或额度明细。保留预览权益提示、独立额度、原会员顺延及查看按钮；页面没有“视觉稿”标签。

## 功能验收

- 四款产品 A/B 原生登录与接口回归通过；分组由服务端决定，URL 参数不能覆盖。B 显示、A 隐藏，正式价格仍为空。
- 产品范式浏览器真实 A 组验收：Banner 数量 0，原来的 0／39／69 元套餐与按钮保留。截图 [A 组](output/banner-implementation/pattern-control-A.jpg)。随后恢复 B 组。
- 共享组件真实 DOM 验证 11 项通过：三款 B／A／接口异常，账号入口保留，曝光归因、安全项目与 hash 返回。接口异常时隐藏入口，原购买控件保留。
- 课伴：付费页 → 中心 → 原 `/billing`，通过手机布局下的实际点击验证。
- AI PM：项目 `#project/union-local-return-project` → 订阅与额度 → 中心 → 同一 hash 项目，通过。
- Workflow：首页 → 点数 → 中心 → 首页；原项目 → 点数 → 中心 → 相同 `projectId`，均通过。首页和编辑页顶栏未重新添加独立联合链接。
- 产品范式：`/pricing` → 中心 → `/pricing`，通过。
- 中心登录后来源产品优先展示；月卡 ¥99、年卡 ¥799 均保留演示标识，购买按钮禁用。服务端报价、真实订单和回调拒绝测试环境请求。原单品价格保留。
- 中心数据库核对：真实订单 0、权益任务 0、非测试事件 0。没有运行生成、转写或真实扣款。
- 四款页面浏览器错误日志均为空；20 个产品 Logo 地址全部返回正确的 SVG 类型，本地中心和预览健康检查正常。

## 检查结果与限制

- 会员服务语法检查通过，37 项测试通过。
- 产品范式入口 5 项测试通过，仓库 `verify` 与前端构建通过。
- AI PM lint、类型检查与构建通过；Workflow 构建通过。原有大包提示保留。
- 课伴修改文件 ESLint 通过，实际登录、Banner、Logo、手机布局与往返通过；**整库生产构建未通过验证**。为避免干扰运行中的开发服务，在隔离副本检查：Turbopack 遇到依赖链接及中文路径内部错误；Webpack 回退在既有 PDF 字体模块的客户端 `node:path` 引用处失败。日志为 `output/banner-implementation/keban-build*.log`。不宣称课伴生产构建通过，也没有修改无关 PDF 代码或部署流程。
- 本地身份为测试模拟，不新增真实跨域 SSO、真实交易与权益验收结论。
- 没有剩余 P0/P1/P2 视觉问题。P3：系统字体与生成稿的字形、插画边缘和真实容器比例存在小幅差异，保留后续微调空间。

## 同步与回退

共享组件与原仓库、联调副本保持一致。`scripts/sync-paywall-banners.mjs` 默认只预览，`--write` 仅同步指定组件和公开素材，校验目标未被并发改动，并保留旧文件。`prepare-local-integration.mjs` 已记录素材清单，后续导出不会遗漏 Logo 与插画。AI PRD 接入包已包含共享组件所需的公开素材。

备份位于 `output/banner-implementation/backups/`，目标清单位于 `sync-state.json`。回退只恢复该清单里的 Banner 文件与本轮新增素材；产品范式原组件、样式可使用首次同步保留的 `pattern-local-component`、`pattern-local-styles`（同步前已验证与原版本一致）。不重置工作区、不回退其他功能、不改数据库。

## 2026-11-06 限定收尾

本轮只补前次未完成的两项，没有重跑已经通过的测试，没有继续排查课伴整库构建，也没有修改应用代码。

- Workflow 已恢复合成 B 组登录，点数面板内显示联合会员入口；[登录恢复截图](output/banner-implementation/workflow-restored.jpg)。
- 从课伴知识库中心的实际“开通 Pro”入口进入 `/knowledge-libraries/ai_pm_preset/checkout?intent=pro&from=knowledge_center`；桌面 1280 × 720、手机 390 × 844 下 Banner 均正常，五个 Logo 加载、无价格、无横向溢出。
- 该次级入口进入中心后，返回同一路径并保留 `intent=pro`、`from=knowledge_center`；没有下单或扣款。
- 新截图为 `output/banner-implementation/keban-checkout-desktop.jpg`、`keban-checkout-mobile.jpg`，页面记录为 `keban-checkout-checks.json`。临时手机尺寸已恢复。
- 课伴整库构建限制继续保留；真实售卖与生产部署均未开启。

final result: passed
