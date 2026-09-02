import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { flatMap, entries, filter, sortBy, pipe, map } from "remeda"
import { useDialog } from "@tui/ui/dialog"
import type { Model } from "@legion/sdk/v2"
import { useConnected } from "@/cli/cmd/tui/component/use-connected"
import { ModelInfoPanel } from "@/kilocode/components/model-info-panel"
import { fmtPrice } from "@/kilocode/components/model-info-panel-utils"
import { FreeModelDisclosure } from "@/kilocode/components/free-model-disclosure"
import { createStore } from "solid-js/store"
import { TextAttributes, type KeyEvent } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useBindings } from "@tui/keymap"
import { useTuiConfig } from "@tui/context/tui-config"
import { DialogVariant } from "@/cli/cmd/tui/component/dialog-variant"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const connected = useConnected()
  const tuiConfig = useTuiConfig()

  const wide = createMemo(() => dimensions().width >= 108)
  const [preview, setPreview] = createSignal<{ model: Model; provider: string }>()

  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [cursor, setCursor] = createSignal(0)

  const lookup = (providerID: string, modelID: string) => {
    const provider = sync.data.provider.find((x) => x.id === providerID)
    const model = provider?.models[modelID]
    if (!provider || !model) return
    return { model, provider: provider.name }
  }

  const providers = createMemo(() => {
    return pipe(
      sync.data.provider,
      filter((p) => p.id !== "opencode" || Object.keys(p.models).length > 0),
      sortBy((p) => p.name),
      map((provider) => {
        const models = pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([modelID, info]) => ({ modelID, info, providerID: provider.id })),
          (items) => sortBy(items, [(i) => i.info.name ?? i.modelID, "asc"]),
        )
        return { ...provider, filteredModels: models }
      }),
      filter((p) => p.filteredModels.length > 0),
    )
  })

  const totalModels = createMemo(() =>
    providers().reduce((sum, p) => sum + p.filteredModels.length, 0),
  )

  type TreeItem =
    | { type: "provider"; providerID: string; name: string; modelCount: number }
    | { type: "model"; providerID: string; modelID: string; model: Model; providerName: string }

  const treeItems = createMemo(() => {
    const items: TreeItem[] = []
    for (const provider of providers()) {
      items.push({
        type: "provider",
        providerID: provider.id,
        name: provider.name,
        modelCount: provider.filteredModels.length,
      })
      const providerExpanded = expanded[`provider:${provider.id}`] !== false
      if (providerExpanded) {
        for (const { modelID, info } of provider.filteredModels) {
          items.push({
            type: "model",
            providerID: provider.id,
            modelID,
            model: info,
            providerName: provider.name,
          })
        }
      }
    }
    return items
  })

  createEffect(() => {
    dialog.setSize(wide() ? "xlarge" : "large")
  })

  createEffect(() => {
    const current = local.model.current()
    if (!current) return
    const next = lookup(current.providerID, current.modelID)
    if (!next) return
    setPreview(next)
  })

  function toggleProvider(providerID: string) {
    const key = `provider:${providerID}`
    setExpanded(key, (v) => (v === undefined ? false : !v))
  }

  function selectModel(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  function move(direction: number) {
    const len = treeItems().length
    if (len === 0) return
    let next = cursor() + direction
    if (next < 0) next = len - 1
    if (next >= len) next = 0
    setCursor(next)
  }

  function submit() {
    const item = treeItems()[cursor()]
    if (!item) return
    if (item.type === "provider") {
      toggleProvider(item.providerID)
    } else {
      selectModel(item.providerID, item.modelID)
    }
  }

  function isCurrent(providerID: string, modelID: string) {
    const cur = local.model.current()
    return cur?.providerID === providerID && cur?.modelID === modelID
  }

  function modelFooter(providerID: string, model: Model) {
    const labels = [
      providerID === "kilo" && FreeModelDisclosure.hasByok(model) ? FreeModelDisclosure.byok : undefined,
      providerID === "kilo" && FreeModelDisclosure.collectsData(model) ? FreeModelDisclosure.label : undefined,
      model.cost?.input === 0 && providerID === "opencode" ? "Free" : undefined,
    ].filter((l) => l !== undefined)
    return labels.length > 0 ? labels.join(" · ") : undefined
  }

  useBindings(() => ({
    commands: [
      {
        name: "dialog.select.prev",
        title: "Previous item",
        category: "Dialog",
        run() {
          move(-1)
        },
      },
      {
        name: "dialog.select.next",
        title: "Next item",
        category: "Dialog",
        run() {
          move(1)
        },
      },
      {
        name: "dialog.select.submit",
        title: "Select item",
        category: "Dialog",
        run: submit,
      },
    ],
    bindings: tuiConfig.keybinds.gather("dialog.select", [
      "dialog.select.prev",
      "dialog.select.next",
      "dialog.select.submit",
    ]),
  }))

  return (
    <box flexDirection="row">
      <box flexGrow={1} flexShrink={1}>
        <box gap={1} paddingBottom={1} flexGrow={1}>
          <box paddingLeft={4} paddingRight={4}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Models ({totalModels()})
              </text>
              <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
                esc
              </text>
            </box>
          </box>
          <box flexGrow={1} flexShrink={1}>
            <scrollbox
              paddingLeft={1}
              paddingRight={1}
              scrollbarOptions={{ visible: false }}
              maxHeight={Math.floor(dimensions().height / 2) - 6}
            >
              <For each={treeItems()}>
                {(item, index) => {
                  const isActive = createMemo(() => cursor() === index())
                  if (item.type === "provider") {
                    return (
                      <ProviderRow
                        name={item.name}
                        modelCount={item.modelCount}
                        expanded={expanded[`provider:${item.providerID}`] !== false}
                        active={isActive()}
                        onClick={() => {
                          setCursor(index())
                          toggleProvider(item.providerID)
                        }}
                      />
                    )
                  }
                  return (
                    <ModelRow
                      model={item.model}
                      providerID={item.providerID}
                      providerName={item.providerName}
                      active={isActive()}
                      current={isCurrent(item.providerID, item.modelID)}
                      footer={modelFooter(item.providerID, item.model)}
                      onClick={() => {
                        setCursor(index())
                        selectModel(item.providerID, item.modelID)
                      }}
                    />
                  )
                }}
              </For>
            </scrollbox>
          </box>
        </box>
      </box>
      <Show when={wide() && preview()}>
        {(item) => <ModelInfoPanel model={item().model} provider={item().provider} />}
      </Show>
    </box>
  )
}

function ProviderRow(props: {
  name: string
  modelCount: number
  expanded: boolean
  active: boolean
  onClick: () => void
}) {
  const { theme } = useTheme()
  const glyph = props.expanded ? "▼" : "▶"
  return (
    <box
      paddingLeft={2}
      paddingRight={3}
      backgroundColor={props.active ? theme.primary : undefined}
      onMouseUp={props.onClick}
    >
      <text fg={props.active ? theme.text : theme.text} attributes={TextAttributes.BOLD}>
        {glyph} {props.name} ({props.modelCount})
      </text>
    </box>
  )
}

function ModelRow(props: {
  model: Model
  providerID: string
  providerName: string
  active: boolean
  current: boolean
  footer?: string
  onClick: () => void
}) {
  const { theme } = useTheme()
  const cost = props.model.cost
  const hasReasoning = props.model.capabilities.reasoning
  const hasCache = cost.cache.read > 0 || cost.cache.write > 0
  const isExpanded = props.active

  return (
    <box flexDirection="column">
      <box
        paddingLeft={4}
        paddingRight={3}
        backgroundColor={props.active ? theme.primary : undefined}
        onMouseUp={props.onClick}
      >
        <text fg={props.active ? theme.text : props.current ? theme.primary : theme.text}>
          {isExpanded ? "▼" : "▶"} {props.model.name ?? props.model.id}
        </text>
        <Show when={props.footer}>
          <text fg={props.active ? theme.text : theme.textMuted}> {props.footer}</text>
        </Show>
      </box>
      <Show when={isExpanded}>
        <box flexDirection="column" paddingLeft={6}>
          <PricingRow label="Input" value={fmtPrice(cost.input)} active={props.active} />
          <PricingRow label="Output" value={fmtPrice(cost.output)} active={props.active} />
          <Show when={hasReasoning}>
            <PricingRow label="Reasoning" value={fmtPrice(cost.output)} active={props.active} />
          </Show>
          <Show when={hasCache}>
            <PricingRow label="Cache read" value={fmtPrice(cost.cache.read)} active={props.active} />
            <PricingRow label="Cache write" value={fmtPrice(cost.cache.write)} active={props.active} />
          </Show>
        </box>
      </Show>
    </box>
  )
}

function PricingRow(props: { label: string; value: string; active: boolean }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" paddingRight={3}>
      <text fg={props.active ? theme.text : theme.textMuted}>{props.label}</text>
      <text fg={props.active ? theme.text : theme.text}>{props.value}</text>
    </box>
  )
}






