/* eslint-disable wc/guard-super-call */
/*
  Eigenständige, neu geschriebene Power Flow Card (TypeScript)
  - Unterstützt beliebig viele individual-Entitäten (als Array)
  - Keine Abhängigkeit zu Original-Implementierungsdetails
  - Minimal, funktional, leicht anpassbar
*/

import { ActionConfig, HomeAssistant, LovelaceCardEditor } from "custom-card-helpers";
import { html, LitElement, PropertyValues, TemplateResult, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

/** Minimaler Config-Typ - erweiterbar */
export interface PowerFlowCardPlusConfig {
  title?: string;
  clickable_entities?: boolean;
  entities: {
    grid?: { entity?: string } | { entity: string } | { entity?: undefined };
    solar?: { entity?: string } | { entity: string } | { entity?: undefined };
    battery?: { entity?: string } | { entity: string } | { entity?: undefined };
    home?: { entity?: string; hide?: boolean } | { entity?: undefined };
    individual?: Array<string | { entity: string; name?: string }>;
  };
  // optional tuning
  individual_min_radius?: number; // in %
  individual_max_radius?: number; // in %
}

@customElement("power-flow-card-plus")
export class PowerFlowCardPlus extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config: PowerFlowCardPlusConfig = { entities: {} };
  @state() private _width = 0;

  public setConfig(config: PowerFlowCardPlusConfig): void {
    if (!config || !config.entities) {
      throw new Error("You must define entities in the config");
    }
    // keep config but provide defaults for radius tuning
    this._config = {
      individual_min_radius: 20,
      individual_max_radius: 45,
      ...config,
    };
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    // no UI editor provided here
    await Promise.resolve();
    return document.createElement("div") as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): object {
    return {
      title: "Power Flow Card Plus (unlimited)",
      entities: {
        grid: { entity: "sensor.grid_power" },
        solar: { entity: "sensor.solar_power" },
        battery: { entity: "sensor.battery_power" },
        home: { entity: "sensor.home_power" },
        individual: [],
      },
    };
  }

  public getCardSize(): number {
    return 3;
  }

  private _getStateNumber(entityId?: string | null): number | null {
    if (!entityId || !this.hass) return null;
    const s = this.hass.states[entityId];
    if (!s) return null;
    const val = parseFloat(String(s.state));
    return Number.isFinite(val) ? val : null;
  }

  private _openMoreInfo(entityId?: string) {
    if (!entityId || !this.hass) return;
    const e = new CustomEvent("hass-more-info", {
      composed: true,
      detail: { entityId },
    });
    this.dispatchEvent(e);
  }

  protected render(): TemplateResult {
    if (!this._config || !this.hass) return html``;
    const entities = this._config.entities || {};
    const gridId = typeof entities.grid === "object" ? (entities.grid.entity as string | undefined) : undefined;
    const solarId = typeof entities.solar === "object" ? (entities.solar.entity as string | undefined) : undefined;
    const batteryId = typeof entities.battery === "object" ? (entities.battery.entity as string | undefined) : undefined;
    const homeId = typeof entities.home === "object" ? (entities.home.entity as string | undefined) : undefined;

    const gridVal = this._getStateNumber(gridId);
    const solarVal = this._getStateNumber(solarId);
    const batteryVal = this._getStateNumber(batteryId);
    const homeVal = this._getStateNumber(homeId);

    // Normalize individual list to objects { entity, name? }
    const rawIndividuals = Array.isArray(entities.individual) ? entities.individual : [];
    const individuals = rawIndividuals.map((it) => {
      if (typeof it === "string") return { entity: it, name: undefined };
      return { entity: (it as any).entity, name: (it as any).name };
    });

    return html`
      <ha-card .header=${this._config.title ?? "Power Flow Card Plus"}>
        <div class="card-body">
          <div class="top-row">
            ${this._renderField("grid", gridVal, gridId)}
            ${this._renderField("solar", solarVal, solarId)}
            ${this._renderField("battery", batteryVal, batteryId)}
            ${!entities.home?.hide ? this._renderField("home", homeVal, homeId) : html``}
          </div>

          <div class="flow-area" id="flowArea">
            <!-- center circle -->
            <div class="center-circle" title="Home">
              ${homeVal !== null ? html`<div class="center-value">${Math.round(homeVal)} W</div>` : html`<div class="center-value">–</div>`}
            </div>

            <!-- dynamic individuals -->
            ${this._renderIndividuals(individuals)}
          </div>

          <div class="footer">
            <div class="legend"><span class="dot grid"></span> Grid</div>
            <div class="legend"><span class="dot solar"></span> Solar</div>
            <div class="legend"><span class="dot battery"></span> Battery</div>
          </div>
        </div>
      </ha-card>
    `;
  }

  private _renderField(kind: "grid" | "solar" | "battery" | "home", value: number | null, entityId?: string | undefined) {
    const label = kind[0].toUpperCase() + kind.slice(1);
    const cls = `field ${kind}`;
    return html`
      <div class="${cls}" @click=${() => this._config.clickable_entities && this._openMoreInfo(entityId)}>
        <div class="field-label">${label}</div>
        <div class="field-value">${value !== null ? `${Math.round(value)} W` : "–"}</div>
        <div class="field-entity">${entityId ?? ""}</div>
      </div>
    `;
  }

  private _renderIndividuals(individuals: Array<{ entity: string; name?: string }>) {
    if (!individuals || individuals.length === 0) return html``;

    const count = individuals.length;
    // Dynamic radius: scales with count; clamp between min and max
    const minR = this._config.individual_min_radius ?? 18;
    const maxR = this._config.individual_max_radius ?? 48;
    // Make radius grow slowly with count so many items arrange on larger circle
    const radius = Math.min(maxR, minR + Math.log10(Math.max(1, count)) * 12 + Math.max(0, (count - 8) * 0.6));

    const offsetAngle = -Math.PI / 2; // start at top
    return html`
      ${individuals.map((item, i) => {
        const angle = offsetAngle + (2 * Math.PI * i) / count;
        const top = 50 - radius * Math.cos(angle);
        const left = 50 + radius * Math.sin(angle);
        const state = this._getStateNumber(item.entity);
        const name = item.name ?? this._niceNameFromEntity(item.entity);

        // line from center to item (SVG)
        const line = this._renderLineFromCenter(left, top);

        return html`
          ${line}
          <div
            class="individual-item"
            style="top: ${top}%; left: ${left}%;"
            title="${item.entity}"
            @click=${(e: Event) => {
              e.stopPropagation();
              if (this._config.clickable_entities) this._openMoreInfo(item.entity);
            }}
          >
            <div class="ind-name">${name}</div>
            <div class="ind-value">${state !== null ? `${Math.round(state)} W` : "–"}</div>
          </div>
        `;
      })}
    `;
  }

  private _renderLineFromCenter(leftPercent: number, topPercent: number) {
    // Create an inline SVG line between center (50%,50%) and (leftPercent, topPercent)
    // Put SVG absolutely so lines stack below items
    const x1 = 50;
    const y1 = 50;
    const x2 = leftPercent;
    const y2 = topPercent;
    const key = `line-${x2}-${y2}`;
    return html`
      <svg class="connector" viewBox="0 0 100 100" preserveAspectRatio="none" key=${key}>
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--primary-text-color)" stroke-width="0.6" opacity="0.5" />
      </svg>
    `;
  }

  private _niceNameFromEntity(entityId: string) {
    try {
      const parts = entityId.split(".");
      const name = parts[1] ?? entityId;
      return name.replace(/_/g, " ");
    } catch {
      return entityId;
    }
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    // recompute width for possible responsive behavior
    const root = this.shadowRoot?.querySelector("#flowArea") as HTMLElement | null;
    if (root) {
      const w = getComputedStyle(root).getPropertyValue("width") || "0px";
      this._width = parseInt(w.replace("px", ""), 10) || this._width;
    }
  }

  static styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      --card-padding: 12px;
    }
    .card-body {
      padding: var(--card-padding);
      font-family: var(--ha-card-font-family, "Roboto", "Noto", sans-serif);
    }
    .top-row {
      display: flex;
      gap: 10px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .field {
      flex: 1 1 120px;
      min-width: 120px;
      background: rgba(0, 0, 0, 0.04);
      border-radius: 6px;
      padding: 8px;
      cursor: default;
    }
    .field-label {
      font-size: 0.75rem;
      color: var(--secondary-text-color);
    }
    .field-value {
      font-weight: 600;
      margin-top: 4px;
    }
    .field-entity {
      font-size: 0.7rem;
      color: var(--secondary-text-color);
      margin-top: 4px;
      word-break: break-all;
    }

    .flow-area {
      position: relative;
      height: 260px;
      margin: 10px 0 6px 0;
      background: transparent;
      overflow: visible;
    }

    .center-circle {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.04);
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 8px;
      box-sizing: border-box;
      font-weight: 600;
    }
    .center-value {
      font-size: 1rem;
    }

    .individual-item {
      position: absolute;
      transform: translate(-50%, -50%);
      min-width: 70px;
      max-width: 140px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 6px;
      padding: 6px 8px;
      text-align: center;
      font-size: 0.82rem;
      box-shadow: none;
      cursor: pointer;
      transition: transform 0.12s ease, box-shadow 0.12s ease;
      border: 1px solid rgba(0, 0, 0, 0.03);
    }
    .individual-item:hover {
      transform: translate(-50%, -50%) scale(1.03);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
    }
    .ind-name {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .ind-value {
      font-size: 0.85rem;
      color: var(--secondary-text-color);
    }

    svg.connector {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
    }

    .footer {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      align-items: center;
    }
    .legend {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 0.85rem;
      color: var(--secondary-text-color);
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.grid {
      background: var(--energy-grid-consumption-color, #f44336);
    }
    .dot.solar {
      background: var(--energy-solar-color, #ffb300);
    }
    .dot.battery {
      background: var(--energy-battery-out-color, #4caf50);
    }

    /* responsive shrink for many entities: reduce font and padding when narrow */
    @media (max-width: 420px) {
      .flow-area {
        height: 200px;
      }
      .center-circle {
        width: 88px;
        height: 88px;
      }
      .individual-item {
        min-width: 56px;
        font-size: 0.75rem;
        padding: 4px 6px;
      }
    }
  `;
}
