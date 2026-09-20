export const TOOLS = [
  {
    name: "yunti_get_tool_usage_hints",
    description:
      "Return current Yunti Browser Runtime MCP tool usage hints, required parameters, common mistakes, and recommended workflows. With no arguments it returns core rules and key tools; pass tool for one tool's schema/hints, or topic for a filtered group. Use this before retrying a failed or uncertain yunti_* tool call.",
    inputSchema: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          description:
            "Optional tool name to focus on, for example yunti_evaluate_script or yunti_close_page.",
        },
        topic: {
          type: "string",
          enum: ["all", "browser", "cdp", "tabs", "memory", "network", "console", "workflow"],
          description: "Optional topic filter. Defaults to all.",
        },
      },
    },
  },
  {
    name: "yunti_get_page_snapshot",
    description:
      "Read a lightweight current-user browser page snapshot: URL, title, auth state, selected text, visible text excerpt, browserSessionId, and optional element summaries. Does not read raw cookies.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: {
          type: "string",
          description:
            "Optional target Yunti browser session owned by the required userId. Use the browserSessionId returned by yunti_get_page_snapshot or the current Yunti browser route for stable current-tab routing.",
        },
        mode: {
          type: "string",
          enum: ["light", "detailed"],
          description:
            "Use light for session/auth/page overview. Use detailed only when element summaries are needed.",
        },
        includeElements: {
          type: "boolean",
          description:
            "Include forms, buttons, inputs, links, and tables. Defaults to true only when mode is detailed.",
        },
        maxTextLength: {
          type: "integer",
          minimum: 0,
          maximum: 60000,
          description: "Maximum visible text characters to return.",
        },
      },
    },
  },
  {
    name: "yunti_observe_page",
    description:
      "Observe the current browser page for agentic operation. Returns an observationId, page/viewport/scroll metadata, a compact interactive text tree, structured elements with fresh uids, scrollable container metadata, redaction metadata, and next-step hints. Prefer this for observe -> act by uid -> verify workflows once available. Sensitive credential-like values are redacted by default; strict redaction also hides likely email, phone, payment-card, and address text surfaces.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: {
          type: "string",
          description:
            "Optional target Yunti browser session. Use the returned browserSessionId for follow-up actions on the same tab.",
        },
        mode: {
          type: "string",
          enum: ["viewport", "fullPage"],
          description:
            "Observation scope. Defaults to viewport; fullPage is bounded by maxElements and maxTextLength.",
        },
        responseMode: {
          type: "string",
          enum: ["full", "delta"],
          description:
            "Use full for the normal complete observation with fresh uid candidates. Use delta for a lighter change summary relative to the previous observe call in the same page context; delta is for verification, not for picking a new uid blindly.",
        },
        maxElements: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "Maximum interactive elements to return. Defaults to a bounded runtime value.",
        },
        maxTextLength: {
          type: "integer",
          minimum: 0,
          maximum: 60000,
          description: "Maximum textTree/visible text characters to return.",
        },
        includeHidden: {
          type: "boolean",
          description: "Include hidden or invisible elements. Defaults to false.",
        },
        includeTextTree: {
          type: "boolean",
          description: "Include the compact agent-facing interactive text tree. Defaults to true.",
        },
        includeRects: {
          type: "boolean",
          description: "Include viewport-relative element rectangles. Defaults to true.",
        },
        redaction: {
          type: "string",
          enum: ["balanced", "strict", "off"],
          description:
            "DOM observation redaction mode. Defaults to balanced. Use off only for explicit local debugging; it is not recommended for agent workflows.",
        },
      },
    },
  },
  {
    name: "yunti_find_elements",
    description:
      "Find a bounded set of interactive page elements matching text, name, role, tag, or placeholder cues without returning a full-page observation. Use this when the agent needs a smaller, targeted candidate set before clicking, filling, selecting, or observing again.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: {
          type: "string",
          description:
            "Optional target Yunti browser session. Use the returned browserSessionId for follow-up actions on the same tab.",
        },
        query: {
          type: "string",
          description:
            "Case-insensitive text query matched against name, label, text, placeholder, selectedText, and href preview.",
        },
        role: {
          type: "string",
          description: "Optional role filter, for example button, textbox, combobox, or link.",
        },
        tag: {
          type: "string",
          description: "Optional tag filter, for example button, input, select, textarea, or a.",
        },
        placeholder: {
          type: "string",
          description: "Optional case-insensitive placeholder substring filter.",
        },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum matches to return. Defaults to 10.",
        },
        includeHidden: {
          type: "boolean",
          description: "Include hidden or invisible elements. Defaults to false.",
        },
        includeRects: {
          type: "boolean",
          description: "Include viewport-relative element rectangles. Defaults to true.",
        },
        redaction: {
          type: "string",
          enum: ["balanced", "strict", "off"],
          description:
            "DOM search redaction mode. Defaults to balanced. Use off only for explicit local debugging.",
        },
      },
    },
  },
  {
    name: "yunti_get_selected_context",
    description:
      "Read the current selection and nearest DOM context from the active browser page.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
      },
    },
  },
  {
    name: "yunti_fetch_with_cookie",
    description:
      "Ask the browser extension to fetch an internal platform URL with the current browser login cookies. Cookie values are never returned.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        browserSessionId: { type: "string" },
        url: { type: "string" },
        method: { type: "string", default: "GET" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string" },
        maxBytes: { type: "integer", minimum: 1024, maximum: 1000000 },
        confirmed: {
          type: "boolean",
          description: "Set true only after the user approved a dangerous non-read request.",
        },
      },
    },
  },
  {
    name: "yunti_get_network_log",
    description:
      "Read recent sanitized internal platform network observations captured by the browser extension. Does not include raw cookies, auth headers, or response bodies.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        allSessions: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        sinceId: { type: "integer", minimum: 1 },
        method: { type: "string" },
        urlContains: { type: "string" },
      },
    },
  },
  {
    name: "yunti_clear_network_log",
    description:
      "Clear sanitized Yunti network observations for the active tab, a selected session, or all sessions.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        allSessions: { type: "boolean" },
      },
    },
  },
  {
    name: "yunti_clear_network_requests",
    description:
      "Clear structured network request observations for the active tab, a selected session, or all sessions. Alias of yunti_clear_network_log with network-request naming.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        allSessions: { type: "boolean" },
      },
    },
  },
  {
    name: "yunti_list_network_requests",
    description:
      "List network requests captured from the active browser page with request ids, resource type, status, timing, and sanitized summaries.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        allSessions: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        sinceId: { type: "integer", minimum: 1 },
        method: { type: "string" },
        urlContains: { type: "string" },
      },
    },
  },
  {
    name: "yunti_get_network_request",
    description:
      "Get a single network request by its event id (from yunti_list_network_requests). Returns URL, method, status, timing, request body summary, and sanitized headers.",
    inputSchema: {
      type: "object",
      required: ["eventId"],
      properties: {
        browserSessionId: { type: "string" },
        eventId: { type: "integer", description: "The event id from yunti_list_network_requests or yunti_get_network_log." },
      },
    },
  },
  {
    name: "yunti_remember_learning",
    description:
      "Store an auditable Yunti learning memory such as an API pattern, workflow step, selector, field mapping, or gotcha. Memory input is sanitized before storage, but agents should still avoid storing secrets, raw cookies, or personal data.",
    inputSchema: {
      type: "object",
      required: ["title", "detail"],
      properties: {
        userId: {
          type: "string",
          description:
            "Optional local route user id. Defaults to YUNTI_BROWSER_USER_ID or local.",
        },
        kind: { type: "string" },
        title: { type: "string" },
        detail: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        source: { type: "string" },
        relatedNetworkEventIds: { type: "array", items: { type: "integer" } },
      },
    },
  },
  {
    name: "yunti_get_learning_memory",
    description: "Search sanitized auditable Yunti learning memories recorded by agents.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description:
            "Optional local route user id. Defaults to YUNTI_BROWSER_USER_ID or local.",
        },
        query: { type: "string" },
        kind: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "yunti_forget_learning_memory",
    description: "Delete one Yunti learning memory by id, or all memories when confirmed.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description:
            "Optional local route user id. Defaults to YUNTI_BROWSER_USER_ID or local.",
        },
        id: { type: "string" },
        all: { type: "boolean" },
        confirmed: { type: "boolean" },
      },
    },
  },
  {
    name: "yunti_apply_preview_patch",
    description:
      "Apply temporary DOM patches to the current browser page. Patches are preview-only and disappear after refresh.",
    inputSchema: {
      type: "object",
      required: ["patches"],
      properties: {
        browserSessionId: { type: "string" },
        patchId: { type: "string" },
        patches: {
          type: "array",
          items: {
            type: "object",
            required: ["selector"],
            properties: {
              selector: { type: "string" },
              text: { type: "string" },
              html: { type: "string" },
              value: { type: "string" },
              appendHtml: { type: "string" },
              beforeHtml: { type: "string" },
              afterHtml: { type: "string" },
              style: { type: "object", additionalProperties: { type: "string" } },
              attributes: { type: "object", additionalProperties: { type: "string" } },
              className: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "yunti_capture_visible_tab",
    description:
      "Capture a PNG screenshot of the visible area of the active Yunti browser tab through the extension. Screenshots are real visible pixels and are not DOM-redacted; use only when visual evidence is needed.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
      },
    },
  },
  {
    name: "yunti_list_browser_targets",
    description:
      "List all Chrome/Edge browser targets visible inside the current user's local browser instance through Yunti Browser Runtime. This is the canonical whole-browser inventory for tab/page counts and target overviews.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: {
          type: "string",
          description:
            "Optional connected Yunti browser session used as the local extension route. Pass the current session id when available.",
        },
      },
    },
  },
  {
    name: "yunti_get_browser_target",
    description:
      "Get one Chrome/Edge browser target from the current user's local browser instance by targetId or tabId. Use this after yunti_list_browser_targets for detailed target inspection without switching browser sessions.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: {
          type: "string",
          description:
            "Optional connected Yunti browser session used as the local extension route. Pass the current session id when available.",
        },
        targetId: {
          type: "string",
          description: "Target id returned by yunti_list_browser_targets.",
        },
        tabId: {
          type: "integer",
          description: "Chrome/Edge tab id returned by yunti_list_browser_targets.",
        },
      },
    },
  },
  {
    name: "yunti_cdp_send_command",
    description:
      "Forward one Chrome DevTools Protocol command through the installed Yunti extension. CDP is a first-class browser-operation backend: use it whenever protocol-level observation, targeting, input, navigation, network, emulation, or diagnostics improve reliability. The required userId is the isolation scope; browserSessionId routes the request to that user's extension/browser instance. Optional tabId or targetId selects the concrete Chrome/Edge target inside that browser, including targets listed by yunti_list_browser_targets that are not registered Yunti sessions. Browser method names such as Target.activateTarget, Runtime.evaluate, Page.navigate, Network.enable, and DOM.* are not terminal/shell commands; call them here through the method and params fields. For current-page or multi-step operations, pass both userId and browserSessionId from yunti_get_page_snapshot or the current Yunti browser route so Runtime.evaluate and follow-up calls stay on the same tab. For switching to a specific tab, use yunti_list_browser_targets with userId/browserSessionId to find tabId or targetId, then call Target.activateTarget through this tool.",
    inputSchema: {
      type: "object",
      required: ["method"],
      properties: {
        browserSessionId: {
          type: "string",
          description:
            "Routes the request to this user's connected Yunti extension session. This is the browser channel, not necessarily the final CDP target when tabId/targetId is set.",
        },
        tabId: {
          type: "number",
          description:
            "Optional Chrome/Edge tab id returned by yunti_list_browser_targets. When set, CDP is sent to this tab even if it is not a registered Yunti page.",
        },
        targetId: {
          type: "string",
          description:
            "Optional target id returned by yunti_list_browser_targets, or tab-<tabId>. When set, CDP is sent to the resolved tab even if it is not a registered Yunti page.",
        },
        method: {
          type: "string",
          description: "Browser protocol method name, for example Runtime.evaluate or Page.captureScreenshot.",
        },
        params: {
          type: "object",
          description: "Raw CDP command parameters.",
          additionalProperties: true,
        },
        protocolVersion: {
          type: "string",
          description: "Debugger protocol version for first attach. Defaults to 1.3.",
        },
        attach: {
          type: "boolean",
          description: "Attach before sending. Defaults to true.",
        },
      },
    },
  },
  {
    name: "yunti_cdp_detach",
    description:
      "Detach the Yunti extension from the active browser tab's low-level browser protocol target.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
      },
    },
  },
  {
    name: "yunti_get_cdp_events",
    description:
      "Read raw low-level browser protocol events forwarded by the browser extension for the active tab. This diagnostic stream intentionally does not redact event payloads; use only for low-level debugging and clear it after debugging.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        allSessions: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        sinceId: { type: "integer", minimum: 1 },
        method: { type: "string" },
      },
    },
  },
  {
    name: "yunti_clear_cdp_events",
    description:
      "Clear raw CDP diagnostic events for the active tab, a selected session, or all sessions.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        allSessions: { type: "boolean" },
      },
    },
  },
  {
    name: "yunti_click_at",
    description:
      "Click a viewport coordinate in the current browser page through the extension. Useful when selector tools are brittle. Dangerous targets require confirmation.",
    inputSchema: {
      type: "object",
      required: ["x", "y"],
      properties: {
        browserSessionId: { type: "string" },
        x: { type: "number", description: "Viewport x coordinate in CSS pixels." },
        y: { type: "number", description: "Viewport y coordinate in CSS pixels." },
        confirmed: { type: "boolean" },
      },
    },
  },
  {
    name: "yunti_type_text",
    description:
      "Type or set text in the focused element, a selector target, a uid target (from yunti_observe_page or yunti_take_snapshot), or a coordinate target on the current browser page.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        browserSessionId: { type: "string" },
        uid: { type: "string", description: "Fresh uid from yunti_observe_page or yunti_take_snapshot." },
        text: { type: "string" },
        selector: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        clear: { type: "boolean", description: "Replace existing text instead of appending." },
      },
    },
  },
  {
    name: "yunti_press_key",
    description:
      "Send a keyboard key event to the focused element, a uid target (from yunti_observe_page or yunti_take_snapshot), a selector target, or a coordinate target on the current browser page.",
    inputSchema: {
      type: "object",
      required: ["key"],
      properties: {
        browserSessionId: { type: "string" },
        uid: { type: "string", description: "Fresh uid from yunti_observe_page or yunti_take_snapshot." },
        key: { type: "string", description: "Examples: Enter, Escape, Tab, ArrowDown, Backspace." },
        selector: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
      },
    },
  },
  {
    name: "yunti_scroll",
    description:
      "Scroll the current browser page, a scrollable container by fresh uid, or the scrollable container under a viewport coordinate through the extension.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        uid: { type: "string", description: "Fresh scrollable container uid from yunti_observe_page. Takes precedence over x/y." },
        x: { type: "number" },
        y: { type: "number" },
        deltaX: { type: "number", default: 0 },
        deltaY: { type: "number", default: 600 },
      },
    },
  },
  {
    name: "yunti_drag",
    description:
      "Drag from one viewport coordinate to another. Uses CDP Input.dispatchMouseEvent sequence: press → move → release. Useful for sliders, sortable lists, and drag-and-drop UI.",
    inputSchema: {
      type: "object",
      required: ["fromX", "fromY", "toX", "toY"],
      properties: {
        browserSessionId: { type: "string" },
        fromX: { type: "number", description: "Start viewport x coordinate." },
        fromY: { type: "number", description: "Start viewport y coordinate." },
        toX: { type: "number", description: "End viewport x coordinate." },
        toY: { type: "number", description: "End viewport y coordinate." },
        steps: { type: "integer", minimum: 1, maximum: 50, description: "Number of intermediate move events. Defaults to 10." },
      },
    },
  },
  {
    name: "yunti_upload_file",
    description:
      "Set files on a file input element by uid (from yunti_observe_page or yunti_take_snapshot) or selector. Uses CDP DOM.setFileInputFiles. Paths must be accessible to the browser.",
    inputSchema: {
      type: "object",
      required: ["filePaths"],
      properties: {
        browserSessionId: { type: "string" },
        uid: { type: "string", description: "Fresh uid from yunti_observe_page or yunti_take_snapshot for the file input." },
        selector: { type: "string", description: "CSS selector for the file input element." },
        filePaths: { type: "array", items: { type: "string" }, description: "Absolute file paths to upload." },
      },
    },
  },
  {
    name: "yunti_rollback_preview_patch",
    description:
      "Rollback one temporary preview patch by patchId, or all preview patches if patchId is omitted.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        patchId: { type: "string" },
      },
    },
  },
  {
    name: "yunti_click",
    description:
      "Click an element on the current browser page using a uid from yunti_observe_page or yunti_take_snapshot, a CSS selector, or viewport coordinates. Prefer a fresh uid for reliability. For coordinate-only clicks, yunti_click_at is the clearer dedicated tool. Dangerous labels require user confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        uid: { type: "string", description: "Fresh uid from yunti_observe_page or yunti_take_snapshot (e.g. yunti-1). Takes precedence over selector." },
        selector: { type: "string", description: "CSS selector. Used when uid is not provided." },
        x: { type: "number", description: "Viewport x coordinate fallback. Use together with y; yunti_click_at is preferred for coordinate-only clicks." },
        y: { type: "number", description: "Viewport y coordinate fallback. Use together with x; yunti_click_at is preferred for coordinate-only clicks." },
        confirmed: { type: "boolean" },
      },
    },
  },
  {
    name: "yunti_hover",
    description:
      "Hover over an element on the current browser page using a uid from yunti_observe_page or yunti_take_snapshot, a CSS selector, or viewport coordinates. Useful for triggering tooltips, dropdowns, and hover menus.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        uid: { type: "string", description: "Fresh uid from yunti_observe_page or yunti_take_snapshot (e.g. yunti-1). Takes precedence over selector." },
        selector: { type: "string", description: "CSS selector fallback. The element center is resolved and hovered through CDP." },
        x: { type: "number", description: "Viewport x coordinate fallback. Use together with y." },
        y: { type: "number", description: "Viewport y coordinate fallback. Use together with x." },
      },
    },
  },
  {
    name: "yunti_fill",
    description:
      "Fill an input, textarea, select, or contenteditable element using a uid from yunti_observe_page or yunti_take_snapshot, or a CSS selector. Prefer a fresh uid for reliability.",
    inputSchema: {
      type: "object",
      required: ["value"],
      properties: {
        browserSessionId: { type: "string" },
        uid: { type: "string", description: "Fresh uid from yunti_observe_page or yunti_take_snapshot (e.g. yunti-3). Takes precedence over selector." },
        selector: { type: "string", description: "CSS selector. Used when uid is not provided." },
        value: { type: "string" },
      },
    },
  },
  {
    name: "yunti_list_console_messages",
    description:
      "List sanitized console messages (console.log, console.error, console.warn, etc.) captured from the active browser page via CDP Runtime/Log events. Supports filtering by level and pagination.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        allSessions: { type: "boolean" },
        level: { type: "string", enum: ["error", "warning", "info", "debug", "log", "verbose"] },
        source: { type: "string", enum: ["console-api", "javascript", "network", "other"] },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        sinceId: { type: "integer", minimum: 1 },
      },
    },
  },
  {
    name: "yunti_get_console_message",
    description:
      "Get a single sanitized console message by its msgid from yunti_list_console_messages. Returns detail including stack trace.",
    inputSchema: {
      type: "object",
      required: ["msgId"],
      properties: {
        browserSessionId: { type: "string" },
        msgId: { type: "integer", description: "The message id from yunti_list_console_messages." },
      },
    },
  },
  {
    name: "yunti_clear_console_messages",
    description:
      "Clear cached console messages for a session, or all sessions.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        allSessions: { type: "boolean" },
      },
    },
  },
  {
    name: "yunti_select",
    description:
      "Select an option in a select element on the current browser page. Supports selector/value plus uid/value or uid/text while keeping selector/value compatible.",
    inputSchema: {
      type: "object",
      anyOf: [
        { required: ["selector", "value"] },
        { required: ["uid", "value"] },
        { required: ["uid", "text"] },
      ],
      properties: {
        browserSessionId: {
          type: "string",
          description: "Optional target Yunti browser session.",
        },
        selector: {
          type: "string",
          description: "Compatible CSS selector path for the select element.",
        },
        uid: {
          type: "string",
          description:
            "Fresh uid path from yunti_observe_page or yunti_take_snapshot. Supports option value or visible text matching.",
        },
        value: {
          type: "string",
          description:
            "Option value to select. Supported with selector or uid.",
        },
        text: {
          type: "string",
          description:
            "Visible option text to select. Supported with uid when the user-facing label is clearer than the value.",
        },
      },
    },
  },
  {
    name: "yunti_fill_form",
    description:
      "Fill multiple form fields at once. Each field specifies a uid (from yunti_observe_page or yunti_take_snapshot) or a selector, and its value. More efficient than calling yunti_fill repeatedly.",
    inputSchema: {
      type: "object",
      required: ["fields"],
      properties: {
        browserSessionId: { type: "string" },
        fields: {
          type: "array",
          items: {
            type: "object",
            required: ["value"],
            properties: {
              uid: { type: "string", description: "Fresh uid from yunti_observe_page or yunti_take_snapshot." },
              selector: { type: "string", description: "CSS selector fallback." },
              value: { type: "string", description: "Value to fill." },
            },
          },
        },
      },
    },
  },
  {
    name: "yunti_handle_dialog",
    description:
      "Handle a JavaScript dialog (alert, confirm, prompt) on the page. Use 'accept' to dismiss or 'dismiss' to cancel. For prompts, provide promptText.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        browserSessionId: { type: "string" },
        action: { type: "string", enum: ["accept", "dismiss"], description: "accept = click OK, dismiss = click Cancel." },
        promptText: { type: "string", description: "Text to enter for prompt dialogs." },
      },
    },
  },
  {
    name: "yunti_resize_page",
    description:
      "Resize the browser page viewport to the specified dimensions. Uses CDP Emulation.setDeviceMetricsOverride.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        width: { type: "integer", minimum: 100, maximum: 10000, description: "Viewport width in CSS pixels." },
        height: { type: "integer", minimum: 100, maximum: 10000, description: "Viewport height in CSS pixels." },
        deviceScaleFactor: { type: "number", minimum: 0.5, maximum: 3, description: "Device pixel ratio. Defaults to 1." },
      },
    },
  },
  {
    name: "yunti_emulate",
    description:
      "Emulate a device, user agent, or network/CPU conditions. Uses low-level browser emulation APIs.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        deviceName: { type: "string", description: "Device name preset: 'iPhone 12', 'Pixel 5', 'iPad', etc." },
        userAgent: { type: "string", description: "Custom user agent string." },
        viewport: { type: "object", properties: { width: { type: "integer" }, height: { type: "integer" }, deviceScaleFactor: { type: "number" } } },
        cpuThrottleRate: { type: "number", minimum: 1, maximum: 20, description: "CPU slowdown factor." },
        networkConditions: { type: "string", enum: ["offline", "slow3g", "fast3g", "slow4g", "none"], description: "Network throttling preset." },
        clear: { type: "boolean", description: "Set to true to clear all emulation overrides." },
      },
    },
  },
  {
    name: "yunti_performance_start_trace",
    description:
      "Start a performance trace on the selected page. Uses the browser tracing API to capture timeline events. Call yunti_performance_stop_trace to end and collect results.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        categories: { type: "string", description: "Comma-separated trace categories. Default: 'blink,loading,rendering,page'." },
      },
    },
  },
  {
    name: "yunti_performance_stop_trace",
    description:
      "Stop the active performance trace and return captured events. Uses the browser tracing API.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
      },
    },
  },
  {
    name: "yunti_new_page",
    description:
      "Create a new browser tab and optionally navigate to a URL. Returns the new tab's browserSessionId for subsequent tool calls.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate the new tab to." },
        active: { type: "boolean", description: "Whether to activate the new tab. Defaults to true." },
      },
    },
  },
  {
    name: "yunti_close_page",
    description:
      "Close a browser tab identified by its browserSessionId. The last connected tab cannot be closed to prevent losing the agent's browser context.",
    inputSchema: {
      type: "object",
      required: ["browserSessionId"],
      properties: {
        browserSessionId: { type: "string" },
      },
    },
  },
  {
    name: "yunti_wait_for",
    description:
      "Wait for a condition to be met on the page: text appears, a selector becomes visible, or the URL changes. Returns compatibility fields such as found/text/selector/waitedMs plus structured action fields when available.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string" },
        text: { type: "string", description: "Wait for this text to appear on the page." },
        selector: { type: "string", description: "Wait for this CSS selector to be visible." },
        urlContains: { type: "string", description: "Wait until the page URL contains this string." },
        timeoutMs: { type: "integer", minimum: 100, maximum: 30000, description: "Max wait time. Defaults to 5000." },
      },
    },
  },
  {
    name: "yunti_list_pages",
    description:
      "List current browser pages/tabs visible inside the current user's local browser instance. Compatibility alias for yunti_list_browser_targets; results come from the same live Chrome/Edge target inventory rather than stale Yunti registration records.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: {
          type: "string",
          description:
            "Optional connected Yunti browser session used as the local extension route. Pass the current session id when available.",
        },
        userId: {
          type: "string",
          description:
            "Required current Yunti user id. Used as the isolation scope for the browser route.",
        },
      },
    },
  },
  {
    name: "yunti_select_page",
    description:
      "Select a connected Yunti browser page as the active session for subsequent session-scoped tool calls. The page must already be registered by Yunti Browser Runtime. Do not pass raw Chrome targetIds here; for whole-browser targets returned by yunti_list_browser_targets, use yunti_cdp_send_command with tabId or targetId instead.",
    inputSchema: {
      type: "object",
      required: ["browserSessionId"],
      properties: {
        browserSessionId: {
          type: "string",
          description:
            "A registered Yunti browserSessionId from yunti_get_page_snapshot or a known Yunti session. Do not pass raw targetId or tabId from browser target inventory here.",
        },
      },
    },
  },
  {
    name: "yunti_navigate_page",
    description:
      "Navigate the selected browser page to a URL, reload, or go back/forward. URL/reload use browser tab APIs; back/forward prefer CDP history entries and fall back to window.history when SPA/hash history is not represented by CDP.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string", description: "Target browser session." },
        url: { type: "string", description: "URL to navigate to. Required when action is 'url'." },
        action: {
          type: "string",
          enum: ["url", "reload", "back", "forward"],
          description: "Navigation action. Defaults to 'url'.",
        },
      },
    },
  },
  {
    name: "yunti_take_screenshot",
    description:
      "Capture a screenshot of the selected browser page. Supports viewport and full-page modes via CDP Page.captureScreenshot. Screenshots are real visible pixels and are not DOM-redacted.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string", description: "Target browser session." },
        format: { type: "string", enum: ["png", "jpeg"], description: "Image format. Defaults to png." },
        quality: { type: "integer", minimum: 0, maximum: 100, description: "JPEG quality (0-100). Ignored for PNG." },
        fullPage: { type: "boolean", description: "Capture full scrollable page. Defaults to false (viewport only)." },
        clip: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
            scale: { type: "number" },
          },
        },
      },
    },
  },
  {
    name: "yunti_evaluate_script",
    description:
      "Evaluate a JavaScript expression in the selected browser page and return the result. Uses CDP Runtime.evaluate. The result is serialized and length-limited.",
    inputSchema: {
      type: "object",
      required: ["expression"],
      properties: {
        browserSessionId: { type: "string", description: "Target browser session." },
        expression: { type: "string", description: "JavaScript expression to evaluate." },
        awaitPromise: { type: "boolean", description: "Wait for the returned promise to resolve. Defaults to false." },
        maxLength: { type: "integer", minimum: 0, maximum: 100000, description: "Max result length. Defaults to 10000." },
      },
    },
  },
  {
    name: "yunti_take_snapshot",
    description:
      "Take an accessibility-tree-based snapshot of the current page. Returns stable uids (yunti-1, yunti-2, ...) for each interactive element. Use these uids with yunti_click, yunti_fill, and yunti_hover. Prefer this over raw selectors or coordinates.",
    inputSchema: {
      type: "object",
      properties: {
        browserSessionId: { type: "string", description: "Target browser session." },
        maxElements: { type: "integer", minimum: 1, maximum: 500, description: "Max elements to return. Defaults to 200." },
        includeHidden: { type: "boolean", description: "Include hidden/invisible elements. Defaults to false." },
      },
    },
  },
  {
    name: "yunti_request_user_confirmation",
    description:
      "Ask the browser user to confirm an action in the browser page before the agent proceeds.",
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        browserSessionId: { type: "string" },
        message: { type: "string" },
        detail: { type: "string" },
      },
    },
  },
]

export const BRIDGE_LOCAL_TOOLS = new Set([
  "yunti_get_network_log",
  "yunti_clear_network_log",
  "yunti_get_cdp_events",
  "yunti_clear_cdp_events",
  "yunti_select_page",
  "yunti_clear_network_requests",
  "yunti_list_console_messages",
  "yunti_get_console_message",
  "yunti_clear_console_messages",
  "yunti_list_network_requests",
  "yunti_get_network_request",
])

export const MEMORY_LOCAL_TOOLS = new Set([
  "yunti_remember_learning",
  "yunti_get_learning_memory",
  "yunti_forget_learning_memory",
])

export const META_LOCAL_TOOLS = new Set([
  "yunti_get_tool_usage_hints",
])

export const BROWSER_SCOPED_TOOLS = new Set(
  TOOLS.map((tool) => tool.name).filter((name) => !MEMORY_LOCAL_TOOLS.has(name) && !META_LOCAL_TOOLS.has(name))
)

const NON_PAGE_TARGET_TOOLS = new Set([
  ...BRIDGE_LOCAL_TOOLS,
  ...MEMORY_LOCAL_TOOLS,
  ...META_LOCAL_TOOLS,
  "yunti_list_browser_targets",
  "yunti_list_pages",
  "yunti_get_browser_target",
  "yunti_cdp_send_command",
  "yunti_new_page",
  "yunti_close_page",
])

installBrowserIsolationSchemas()

function installBrowserIsolationSchemas() {
  for (const tool of TOOLS) {
    if (MEMORY_LOCAL_TOOLS.has(tool.name)) continue
    const schema = tool.inputSchema || { type: "object" }
    schema.properties = schema.properties || {}
    schema.properties.userId = {
      type: "string",
      description:
        "Optional local route user id. Defaults to YUNTI_BROWSER_USER_ID or local in the standalone runtime.",
    }
    schema.properties.browserInstanceId ||= {
      type: "string",
      description:
        "Optional browser/profile instance id returned by yunti_list_browser_targets. Use it only when Chrome, Edge, or multiple profiles expose overlapping tab ids.",
    }
    if (!NON_PAGE_TARGET_TOOLS.has(tool.name)) {
      schema.properties.tabId ||= {
        type: "integer",
        description:
          "Optional Chrome/Edge tab id from yunti_list_browser_targets. In 0.2.3+, the browser controller uses it to establish or recover the page session automatically.",
      }
      schema.properties.targetId ||= {
        type: "string",
        description:
          "Optional target id from yunti_list_browser_targets. Use it when browserSessionId is unavailable or stale; Yunti resolves and recovers the page route automatically.",
      }
      schema.properties.pageHandleId ||= {
        type: "string",
        description:
          "Preferred durable route for multi-step work: the opaque pageHandleId returned by yunti_list_browser_targets for a live tab. It survives navigation, reload, content-script reinjection, extension reconnect, and Bridge restart while the same tab and browser instance exist. Never parse, edit, or persist it across a tab close. Do not combine it with a conflicting tabId, targetId, browserInstanceId, or browserSessionId.",
      }
    }
    tool.inputSchema = schema
  }
}



export function schemaForTool(name) {
  return TOOLS.find((tool) => tool.name === name)?.inputSchema || null
}

export function toolUsageHints(args = {}) {
  const requestedTool = String(args.tool || "").trim()
  const topic = String(args.topic || "all").trim() || "all"
  const tools = {
    yunti_get_page_snapshot: {
      purpose: "Establish the current Yunti browser route and read lightweight page state.",
      required: [],
      recommended: ["browserSessionId"],
      notes: [
        "Use this first for current-page work when browserSessionId is unknown.",
        "Keep the returned browserSessionId for follow-up current-tab tools.",
        "In 0.2.3+, an old page browserSessionId with a live tab is recovered automatically; tabId or targetId can also select and recover a page directly.",
        "In 0.2.4+, Edge sleeping tabs use bounded automatic recovery. Yunti may briefly activate the target and then restore the previously active tab; do not ask the user to refresh or switch tabs first.",
      ],
    },
    yunti_observe_page: {
      purpose: "Observe the current page for observe -> act by uid -> verify workflows.",
      required: [],
      recommended: ["browserSessionId", "mode", "redaction"],
      examples: [
        {
          browserSessionId: "yunti-...",
          mode: "viewport",
          responseMode: "full",
          includeTextTree: true,
          redaction: "balanced",
        },
        {
          browserSessionId: "yunti-...",
          mode: "viewport",
          responseMode: "delta",
          redaction: "balanced",
        },
      ],
      notes: [
        "Use this as the default page-operation refresh step once available.",
        "Returned uids are fresh for the latest observation in the current browserSessionId; observe again after navigation, DOM changes, or stale uid errors.",
        "responseMode=delta returns a lighter change summary relative to the previous observation in the same page context. It is useful for post-action verification and repeated checks when a full textTree/elements payload would be too large.",
        "responseMode=delta does not replace the normal full observe path for choosing the next uid. When a delta indicates change and another action is needed, call responseMode=full before picking a fresh uid.",
        "Input-like elements may include editable, fillable, readOnly, fillBlockReason, selectedIndex/selectedValue/selectedText, and select options[] summaries so agents can inspect field state before filling or selecting.",
        "Default balanced redaction hides credential-like values. Strict redaction additionally hides likely email, phone, Luhn-valid payment-card-like values, address-like text, page titles, labels, names, visible text, placeholders, value previews, and select option text.",
        "Screenshots are separate and may still contain visible sensitive content.",
        "Use yunti_get_page_snapshot for lightweight route/title/text overview and yunti_take_snapshot for compatibility with older uid workflows.",
      ],
      commonMistakes: [
        "Do not treat observation uids as permanent selectors across refreshes or tabs.",
        "Do not treat responseMode=delta as a full replacement for choosing the next action target; use full observe before acting on a new uid.",
        "Do not use redaction=off unless the user explicitly wants local debugging.",
        "Do not blindly retry an action after no page change; observe, wait, scroll, or switch tabs based on hints.",
        "A page-operation timeout does not imply that the browser controller is disconnected. List targets and retry the intended live tab once before asking the user to intervene.",
      ],
    },
    yunti_find_elements: {
      purpose: "Find a bounded candidate set of interactive elements by text/name/role cues before acting or doing a full observation.",
      required: [],
      recommended: ["browserSessionId", "query", "role", "maxResults"],
      notes: [
        "Use this when a full-page observation would be too large or when the page already has many controls.",
        "Matches are case-insensitive and search across name, label, text, placeholder, selectedText, and href preview.",
        "Returned uids are fresh for the current browserSessionId and can be used like other observe-page uids.",
        "Prefer this for targeted lookups such as 'Save', 'Submit', 'Search', a field label, or a specific button role.",
        "If no match is found, broaden the query, drop the role/tag filter, scroll, or fall back to yunti_observe_page.",
      ],
      commonMistakes: [
        "Do not assume it searches the whole DOM regardless of visibility; includeHidden=false is the default.",
        "Do not treat returned uids as permanent selectors across rerenders or navigation.",
        "Do not use it as a replacement for full-page verification after an action; observe or verify separately.",
      ],
    },
    yunti_list_browser_targets: {
      purpose: "Canonical live Chrome/Edge tab and target inventory.",
      required: [],
      recommended: ["browserSessionId"],
      notes: [
        "Use for page counts, all tabs, finding a tab, or choosing a CDP target.",
        "In 0.2.5+, each browser/profile has its own controller. With no explicit route, target inventory aggregates all compatible connected browser instances.",
        "Each page includes browserInstanceId, browserFamily, and routeBrowserSessionId so overlapping Chrome/Edge tab ids remain unambiguous.",
        "In 0.2.7+, each page row also includes an opaque pageHandleId. Prefer it for multi-step work: it survives navigation, reload, content-script reinjection, extension reconnect, and Bridge restart while the same tab and browser instance exist.",
        "A page row's browserSessionId/pageSessionId is null until registered; routeBrowserSessionId is the controller transport, not a page id.",
        "Pass a returned tabId or targetId directly to observe/click/fill when needed; the controller establishes the content-script page session automatically.",
        "If a stale browserSessionId was supplied accidentally, target inventory falls back to the live controller route.",
        "In 0.2.4+, Edge sleeping-tab injection can briefly activate the target and restore the previous tab automatically; do not require a manual refresh, tab switch, or browser restart as the default recovery.",
      ],
    },
    pageHandleId: {
      purpose: "Opaque durable route for one live tab inside one browser instance.",
      required: [],
      recommended: ["pageHandleId"],
      notes: [
        "Returned by yunti_list_browser_targets and yunti_list_pages for every routable http/https tab, and accepted by page tools as an optional route input.",
        "Treat it as opaque: never parse, edit, reconstruct, or persist it. A handle that is not returned by the live inventory is invalid.",
        "It survives navigation, reload, content-script reinjection, MV3 worker suspension, extension reconnect, and Bridge restart while the same tab and browser instance exist.",
        "It is terminal when the tab closes, when the owning browser instance disconnects (YUNTI_PAGE_HANDLE_CLOSED), when the numeric tab id was reused for a different tab (YUNTI_PAGE_HANDLE_STALE), or when the value is malformed (YUNTI_PAGE_HANDLE_INVALID). Those failures have retryBudget=0.",
        "A read operation may continue after internal route recovery inside one tool call; a write operation is dispatched only once per request. If a write's result is uncertain, the runtime returns resultUncertain=true instead of replaying it.",
        "Combining pageHandleId with a conflicting tabId, targetId, browserInstanceId, or browserSessionId fails with YUNTI_PAGE_HANDLE_ROUTE_MISMATCH rather than silently picking one.",
        "Browser-level and raw CDP tools (list targets, list pages, get target, cdp_send_command, new/close page, select page, and the diagnostic/memory tools) do not accept a handle.",
      ],
      commonMistakes: [
        "Do not treat pageHandleId as an element uid; observation uids remain fresh and observation-scoped.",
        "Do not keep using a handle after the user closes that tab; list targets again.",
      ],
    },
    yunti_list_pages: {
      purpose: "Compatibility alias for the same live target inventory as yunti_list_browser_targets.",
      required: [],
      recommended: ["browserSessionId"],
      notes: [
        "Do not treat this as a separate Yunti registration registry.",
        "Prefer yunti_list_browser_targets in new prompts and workflows.",
      ],
    },
    yunti_cdp_send_command: {
      purpose: "Use CDP as a first-class browser backend for reliable protocol-level observation and operation.",
      required: ["method"],
      recommended: ["browserSessionId", "method", "params"],
      examples: [
        {
          browserSessionId: "yunti-...",
          tabId: 123,
          method: "Target.activateTarget",
          params: {},
        },
        {
          browserSessionId: "yunti-...",
          method: "Runtime.evaluate",
          params: { expression: "document.title", returnByValue: true },
        },
      ],
      commonMistakes: [
        "Do not run CDP method names in a shell.",
        "params must be an object when provided; do not pass a string or array.",
        "For tab operations, pass top-level tabId or targetId together with browserSessionId.",
        "For Target.closeTarget, call yunti_list_browser_targets first, then pass a returned top-level tabId or targetId.",
        "In 0.2.3+, stale legacy page ids and explicit tabId/targetId routes recover through the controller before CDP dispatch.",
        "Do not avoid CDP merely because Chrome may show a debugger banner; choose the backend that best completes and verifies the browser task.",
        "If another backend may already have executed a write action, verify page state before replaying the same action through CDP.",
      ],
    },
    yunti_get_cdp_events: {
      purpose: "Inspect raw low-level CDP events for debugging transport, protocol, or extension behavior.",
      required: [],
      recommended: ["browserSessionId", "method", "limit"],
      notes: [
        "This tool intentionally returns raw CDP event payloads and does not apply network, console, DOM, or learning-memory sanitization.",
        "Use sanitized network and console tools first when they can answer the question.",
        "Filter by method and keep limit small to reduce sensitive payload exposure.",
        "Clear raw CDP events after debugging with yunti_clear_cdp_events.",
      ],
      recovery: [
        "After reading raw CDP diagnostics, call yunti_clear_cdp_events for the same browserSessionId or allSessions when appropriate.",
        "If you need to keep a durable note, summarize the safe conclusion with yunti_remember_learning instead of copying raw event payloads.",
      ],
      commonMistakes: [
        "Do not copy raw CDP params into chat, logs, learning memory, or documentation.",
        "Do not use raw CDP events as the default page observation path; prefer yunti_observe_page, sanitized network tools, and sanitized console tools.",
      ],
    },
    yunti_clear_cdp_events: {
      purpose: "Delete raw CDP diagnostic events after low-level debugging.",
      required: [],
      recommended: ["browserSessionId"],
      notes: [
        "Use browserSessionId to clear one tab's raw diagnostics, or allSessions=true with the current userId when ending a broader debugging session.",
        "Clearing raw CDP events does not clear sanitized network or console diagnostics.",
      ],
    },
    yunti_take_screenshot: {
      purpose: "Capture visual page evidence for layout, rendering, or user-visible verification.",
      required: [],
      recommended: ["browserSessionId", "fullPage"],
      notes: [
        "Screenshots are real visible pixels and are not DOM-redacted.",
        "Use yunti_observe_page with redaction=strict first when structured text is enough.",
        "Prefer viewport screenshots over fullPage when a smaller visual proof is sufficient.",
        "Do not store screenshots in learning memory; summarize only safe visual findings.",
      ],
      commonMistakes: [
        "Do not assume DOM redaction hides sensitive content in screenshots.",
        "Do not use screenshots as the default data extraction path when observe, snapshot, network, console, or evaluate can provide a safer answer.",
      ],
    },
    yunti_capture_visible_tab: {
      purpose: "Capture the active visible tab for visual verification through the extension fallback path.",
      required: [],
      recommended: ["browserSessionId"],
      notes: [
        "Like yunti_take_screenshot, this returns real visible pixels and is not DOM-redacted.",
        "Use it only when visual state matters and structured observations are insufficient.",
        "Do not store raw screenshot data in learning memory.",
      ],
      commonMistakes: [
        "Do not expose visible secrets from the screenshot; describe only the safe conclusion.",
      ],
    },
    yunti_evaluate_script: {
      purpose: "Evaluate JavaScript in the selected browser page.",
      required: ["expression"],
      aliases: { script: "expression" },
      examples: [
        {
          browserSessionId: "yunti-...",
          expression: "document.title",
          awaitPromise: false,
        },
      ],
      commonMistakes: ["Use expression, not script."],
    },
    yunti_new_page: {
      purpose: "Create a new browser tab.",
      required: [],
      recommended: ["browserSessionId", "url", "active"],
      notes: [
        "Returns a new browserSessionId for the created tab.",
        "Use the returned browserSessionId for follow-up yunti_* calls on the new tab.",
      ],
    },
    yunti_close_page: {
      purpose: "Close a registered Yunti browser page by browserSessionId.",
      required: ["browserSessionId"],
      commonMistakes: [
        "This tool does not accept tabId or targetId.",
        "Passing tabId or targetId will be rejected instead of selecting the close target.",
      ],
      alternatives: [
        "To close by tabId or targetId, route through yunti_cdp_send_command with the current browserSessionId and Target.closeTarget.",
      ],
    },
    yunti_select_page: {
      purpose: "Select a registered Yunti browser session.",
      required: ["browserSessionId"],
      commonMistakes: [
        "Do not pass raw Chrome targetId or tabId here.",
        "Use yunti_cdp_send_command for raw browser targets from yunti_list_browser_targets.",
      ],
    },
    yunti_forget_learning_memory: {
      purpose: "Delete one learning memory by id, or delete all memories when confirmed.",
      required: [],
      recommended: ["id"],
      notes: [
        "Call yunti_get_learning_memory first to find the memory id.",
        "Use all=true and confirmed=true only when deleting every memory for this user.",
        "If the returned deleted count is 0, refresh the memory list and retry with an existing id.",
      ],
      commonMistakes: ["Use id, not title."],
    },
    yunti_remember_learning: {
      purpose: "Persist a sanitized local learning memory for future agent runs.",
      required: ["title", "detail"],
      recommended: ["kind", "tags", "confidence", "source"],
      notes: [
        "Learning memory sanitizes likely secrets and PII-like text before writing to disk.",
        "Do not intentionally store raw cookies, authorization headers, tokens, passwords, private keys, payment data, or personal contact details.",
        "Use relatedNetworkEventIds to reference sanitized network observations instead of copying raw payloads into memory.",
      ],
      commonMistakes: [
        "Do not use learning memory as task history or a transcript store.",
        "Do not store raw CDP event payloads in memory.",
      ],
    },
    yunti_wait_for: {
      purpose: "Wait for expected text, a visible selector, or a URL substring before observing and continuing with fresh uids.",
      required: [],
      recommended: ["browserSessionId", "text or selector or urlContains", "timeoutMs"],
      notes: [
        "Use this when the page is rendering asynchronously, loading select options, validating a field, navigating, or appending scroll content.",
        "At least one of text, selector, or urlContains is required.",
        "Successful results preserve compatibility fields such as found, text, selector, condition, value, waitedMs, and browserSessionId.",
        "P6.2.6 structured fields are additive: action=wait_for, target, ok, recoverable, and nextStepHint.",
        "Timeout results return found=false, ok=false, recoverable=true, code=WAIT_TIMEOUT, recoveryHint, and nextStepHint.",
        "After a successful wait, call yunti_observe_page before using uids for newly rendered content.",
      ],
      recovery: [
        "WAIT_TIMEOUT: observe the current page, inspect whether the expected condition changed, or adjust text/selector/urlContains before retrying.",
        "Async form/select work: wait for the expected text/selector/state, observe again, then fill/select with a fresh uid.",
        "Async scroll work: wait for the next expected text/selector, observe again, then choose a fresh scrollable container uid.",
        "Wrong tab or stale route: refresh targets with yunti_list_browser_targets and route through the intended browserSessionId.",
      ],
      commonMistakes: [
        "Do not treat WAIT_TIMEOUT as proof the task failed; inspect the page state before deciding.",
        "Do not keep repeating the same wait condition without observing or adjusting it.",
        "Do not reuse old uids after waiting for new async content; observe again first.",
      ],
    },
    yunti_click: {
      purpose: "Click by observe/snapshot uid, CSS selector, or viewport coordinates.",
      required: [],
      recommended: ["browserSessionId", "uid"],
      notes: [
        "Prefer a fresh uid from yunti_observe_page or yunti_take_snapshot for reliability.",
        "Use selector when uid is unavailable.",
        "Coordinate mode requires both x and y; yunti_click_at is clearer for coordinate-only clicks.",
        "After clicking, observe again or read page state before deciding whether the action succeeded.",
        "If the target is missing or stale, observe again; if it may be below the fold, scroll first; if the page is changing, wait before retrying.",
        "Current results are compatibility-shaped and may include clicked, uid, selector/coordinate, method, and browserSessionId; P6.2 will converge action outputs toward action, target, ok/code, recoverable, nextStepHint, and before/after summaries.",
      ],
      recovery: [
        "Stale or missing uid: call yunti_observe_page again for the current browserSessionId, or yunti_take_snapshot for compatibility workflows.",
        "Element not visible: use observe scroll hints, yunti_scroll, or a screenshot before falling back to coordinates.",
        "No visible page change: call yunti_observe_page or yunti_get_page_snapshot to verify, then wait, scroll, switch tabs, or ask the user instead of repeating the same click.",
        "Wrong page: call yunti_list_browser_targets and switch to the intended browserSessionId.",
      ],
      commonMistakes: [
        "Do not treat a successful dispatch as proof that the page changed.",
        "Do not repeat the same uid click after a stale uid error; refresh the observation first.",
      ],
    },
    yunti_hover: {
      purpose: "Hover by observe/snapshot uid, CSS selector, or viewport coordinates.",
      required: [],
      recommended: ["browserSessionId", "uid"],
      notes: [
        "Prefer a fresh uid from yunti_observe_page or yunti_take_snapshot for reliability.",
        "Selector mode resolves the element center and dispatches CDP mouse move.",
        "Coordinate mode requires both x and y.",
        "Observe again after hover when menus, tooltips, or hover-only controls are expected to appear.",
        "Current results are compatibility-shaped and may include hovered, uid, selector/coordinate, method, and browserSessionId; P6.2 will converge action outputs toward action, target, ok/code, recoverable, nextStepHint, and before/after summaries.",
      ],
      recovery: [
        "Stale or missing uid: observe again before retrying the hover.",
        "Expected menu did not appear: wait briefly, observe again, or use screenshot before switching to coordinate fallback.",
      ],
    },
    yunti_fill: {
      purpose: "Fill an input-like element by observe/snapshot uid or CSS selector.",
      required: ["value"],
      recommended: ["browserSessionId", "uid", "value"],
      notes: [
        "value is required and may be an empty string when intentionally clearing a field.",
        "Prefer a fresh uid from yunti_observe_page or yunti_take_snapshot for reliability.",
        "Use selector when uid is unavailable.",
        "Coordinate-only fill is not supported; use uid or selector.",
        "Uid-targeted contenteditable fills now report method=contenteditable with before/after textLength summaries; still verify the rendered text after the action.",
        "Failed uid/selector fills may return structured filled=false diagnostics with ok=false, recoverable=true, code, recoveryHint, and nextStepHint instead of only a generic tool error.",
        "Non-editable, hidden, disabled, or readonly fill targets should return TARGET_NOT_EDITABLE diagnostics instead of being treated as successful fills.",
        "Uid keyboard/contenteditable fills verify the post-fill value when possible; if the value does not remain, they return VALUE_NOT_APPLIED with expectedValueLength/actualValueLength instead of exposing the raw field value.",
        "When yunti_fill_form uses yunti_fill internally, failed per-field results may preserve code, recoveryHint, availableValues/availableTexts, and nextStepHint for field-level recovery.",
        "After filling, verify through yunti_observe_page, yunti_get_page_snapshot, or yunti_evaluate_script when exact field value matters.",
        "If the input is hidden, disabled, or no longer present, observe again, scroll, wait for rendering, or switch tabs before retrying.",
        "Current results are compatibility-shaped and may include filled, uid, selector, method, value/valueLength, before/after, code, recoveryHint, and browserSessionId; P6.2 will converge action outputs toward action, target, ok/code, recoverable, nextStepHint, and richer before/after summaries.",
      ],
      recovery: [
        "Stale or missing uid: call yunti_observe_page again and use a fresh editable uid.",
        "Structured fill failure: follow recoveryHint.nextAction / recoveryHint.decision before retrying the same fill.",
        "Batch fill partial failure: inspect each yunti_fill_form results[] item; failed fields may carry the same structured recovery details as yunti_fill.",
        "Async render or validation changed the field: use yunti_wait_for for the expected text/selector/state, then call yunti_observe_page and retry with a fresh editable uid.",
        "Field not editable: check disabled/editable fields from the observation, then wait, scroll, or ask the user if the control is gated.",
        "Select option not found: inspect availableValues / availableTexts, then retry with an available option value/text or use yunti_select.",
        "VALUE_NOT_APPLIED / value did not stick: inspect whether the target is contenteditable, masked, controlled by framework state, or requires typing/press_key semantics before retrying.",
        "Wrong page: refresh targets with yunti_list_browser_targets and route the fill through the intended browserSessionId.",
      ],
      commonMistakes: [
        "Do not omit value.",
        "Do not pass only x/y coordinates to yunti_fill.",
        "Do not keep retrying a fill without observing whether the field exists and is editable.",
      ],
    },
    yunti_scroll: {
      purpose: "Scroll the document, a fresh observed scrollable container uid, or the scrollable container under viewport coordinates.",
      required: [],
      recommended: ["browserSessionId", "uid", "deltaY"],
      notes: [
        "Prefer a fresh scrollable container uid from yunti_observe_page when the observation exposes scrollableContainers[].",
        "Uid scroll resolves the observed container center and reuses the existing coordinate/container scroll path.",
        "Coordinate scroll remains compatible for recovery and debugging when uid is unavailable.",
        "Coordinate scroll results may include coordinateTarget, scrollContainerFound, coordinateScrollFallback=document, and coordinateFallbackHint so agents can tell whether the coordinate hit a scrollable container or fell back to document scrolling.",
        "Current results preserve scrolled, deltaX/deltaY, target, before/after, browserSessionId, action, ok, recoverable, and nextStepHint; uid path also adds uid, method=uid, and scrollTarget without replacing target.",
        "When before/after positions are comparable, results include moved; no movement returns code=NO_SCROLL_MOVEMENT, ok=false, recoverable=true, edgeHint such as possible-bottom-edge when direction can be inferred, and recoveryHint with nextAction/recommendedTools, decision, plus suggestedRetry when an opposite delta can be derived.",
        "Partial movement returns partialMovement with requested/actual delta summaries, axes, edgeHint, decision=observe-before-continuing-scroll, and an observe-again next action while keeping ok=true.",
        "Uid scroll failures can return structured scrolled=false diagnostics with code, recoveryHint, and nextStepHint when the uid is missing, stale, hidden, or cannot resolve coordinates.",
      ],
      recovery: [
        "Stale or missing uid: follow recoveryHint.decision, call yunti_observe_page again, and use a fresh scrollable container uid from scrollableContainers[].",
        "Wrong container moved or did not move: observe again and compare scrollableContainers before/after positions.",
        "Coordinate fallback moved document instead of a nested panel: inspect coordinateTarget, coordinateScrollFallback, and coordinateFallbackHint; observe again and prefer a fresh scrollable container uid.",
        "No movement: read recoveryHint.decision, edgeHint, and suggestedRetry; observe again, inspect likely scroll boundaries, try the nearest observed scrollable container uid, or stop repeating the same scroll.",
        "Partial movement: read partialMovement, observe again, and compare scroll positions before repeating the same scroll.",
        "Async content is still loading: use yunti_wait_for for the next expected text/selector, then observe again and choose a fresh scrollable container uid before retrying.",
        "Element still outside viewport: scroll the nearest scrollable container first, then observe and act by fresh uid.",
        "Wrong tab or stale route: refresh targets with yunti_list_browser_targets and route through the intended browserSessionId.",
      ],
      commonMistakes: [
        "Do not assume document scroll will move nested app panels; use observed scrollable container uids when available.",
        "Do not overwrite or reinterpret the existing target field; uid scroll adds scrollTarget while preserving target compatibility.",
        "Do not blindly repeat scroll when moved=false or NO_SCROLL_MOVEMENT appears; read recoveryHint/edgeHint, observe, or inspect boundaries first.",
        "Do not blindly repeat uid scroll when code=UID_NOT_FOUND or UID_COORDINATES_UNAVAILABLE appears; refresh observation first.",
        "Do not blindly repeat partial scrolls without observing whether the target container hit an edge.",
      ],
    },
    yunti_select: {
      purpose: "Select an option in a select element by selector/value, fresh uid/value, or fresh uid/visible text while preserving the current selector/value path.",
      required: [],
      recommended: ["browserSessionId", "uid", "value"],
      notes: [
        "Current runtime behavior supports selector/value, uid/value, and uid/text; selector/value remains compatible for existing workflows.",
        "Prefer a fresh uid from yunti_observe_page or yunti_take_snapshot when available, then verify the selected option afterward.",
        "Use visible option text when the user-facing label is clearer than the option value.",
        "Current successful results preserve selected, element, value, text, uid/selector, browserSessionId, action, target, ok, recoverable, and nextStepHint.",
        "Uid and selector option misses, disabled options, and non-select targets now return structured selected=false diagnostics with code, matchMode, targetOption, availableValues/availableTexts when available, disabledValue/disabledText for disabled options, and recoveryHint.",
      ],
      recovery: [
        "Selector path fails: observe again, inspect the select element, then retry with a stable selector or wait for the form to render.",
        "Selector value does not match: read recoveryHint, inspect available options, then retry with the correct selector/value or fresh uid/value fallback.",
        "Uid path fails: refresh with yunti_observe_page before retrying the same uid.",
        "Option is not found: read recoveryHint, inspect available options via availableValues/availableTexts, then retry with the correct uid/text, uid/value, or selector/value fallback.",
        "Option is disabled: read recoveryHint.disabledValue / disabledText, choose an enabled option, wait for the field to unlock, or ask the user before retrying.",
        "Options are populated asynchronously: use yunti_wait_for for the expected option text or form state, then observe again and select with a fresh uid/text or uid/value.",
        "Uid target is not a select element: read recoveryHint.decision, observe again, target the actual select uid, or use selector/value fallback.",
        "Wrong tab or stale route: refresh targets with yunti_list_browser_targets and route through the intended browserSessionId.",
      ],
      commonMistakes: [
        "Do not pass text without uid; selector path remains selector/value compatible.",
        "Do not remove selector/value compatibility while adding uid support.",
        "Do not treat a selected=true result as final proof when the workflow depends on the changed page state; observe or evaluate the field value.",
        "Do not blindly retry the same selector if the page is still rendering or the option list is dynamic.",
      ],
    },
  }
  const topicMap = {
    browser: ["yunti_observe_page", "yunti_find_elements", "yunti_wait_for", "yunti_get_page_snapshot", "yunti_list_browser_targets", "yunti_list_pages"],
    cdp: ["yunti_cdp_send_command", "yunti_evaluate_script"],
    tabs: ["yunti_new_page", "yunti_close_page", "yunti_select_page", "yunti_list_browser_targets"],
    memory: ["yunti_get_learning_memory", "yunti_remember_learning", "yunti_forget_learning_memory"],
    network: ["yunti_get_network_log", "yunti_list_network_requests", "yunti_get_network_request", "yunti_clear_network_requests"],
    console: ["yunti_list_console_messages", "yunti_get_console_message", "yunti_clear_console_messages"],
    workflow: ["yunti_get_tool_usage_hints", "yunti_list_browser_targets", "yunti_observe_page", "yunti_find_elements", "yunti_wait_for"],
  }
  const selectedNames = requestedTool
    ? [requestedTool]
    : topic !== "all" && topicMap[topic]
      ? topicMap[topic]
      : Object.keys(tools)
  const selectedTools = {}
  for (const name of selectedNames) {
    selectedTools[name] = {
      ...(tools[name] || {
        purpose: "No specialized hint is available for this tool. Use the schema field below.",
      }),
      schema: schemaForTool(name),
    }
  }
  return {
    version: "2026-07-22",
    coreRules: [
      "Every browser-facing yunti_* tool call requires userId.",
      "browserSessionId is the current user's browser route; tabId and targetId are selectors, not permissions.",
      "yunti_list_browser_targets is the canonical live browser inventory.",
      "yunti_list_pages is a compatibility alias for the same live target inventory.",
      "For multi-step page work, prefer the opaque pageHandleId returned by target inventory. It survives navigation, reload, reinjection, extension reconnect, and Bridge restart while the same tab and browser instance exist; treat a closed tab, a reused numeric tab id, or a malformed value as terminal with retryBudget=0.",
      "For page operations, prefer observe -> act by fresh uid -> observe/verify once yunti_observe_page is available.",
      "In 0.2.5+, one controller per browser/profile transports that instance's browser and page tools; page sessions do not open independent long polls.",
      "Treat retryable, retryBudget, recoveryAction, and resultUncertain as authoritative. One failure chain shares one retry budget across all recovery layers.",
      "YUNTI_BRIDGE_RUNTIME_MISMATCH, YUNTI_EXTENSION_PROTOCOL_MISMATCH, YUNTI_BROWSER_INSTANCE_AMBIGUOUS, and the YUNTI_PAGE_HANDLE_* failures have retryBudget=0; stop and follow recoveryAction instead of retrying.",
      "If a page browserSessionId is stale, follow the structured recoveryAction and spend at most its shared retryBudget; never retry the expired id itself.",
      "After yunti_new_page, use the returned browserSessionId for follow-up calls on the new tab.",
      "The controller heartbeat keeps metadata for tabs that still exist and removes routes for closed tabs.",
      "If a tool call fails due to parameters, inspect this hint output and the tool schema before retrying.",
      "Choose content-script actions, CDP, screenshots, network tools, or console tools according to which path can operate and verify the page most reliably; CDP is not a restricted fallback.",
      "Chrome may show a debugger banner while CDP is attached. Treat that as informational, not as a reason to avoid CDP or weaken the browser workflow.",
      "Use CDP proactively for cross-origin frames, shadow DOM, canvas, precise input, protocol-level navigation, browser targets, network control, emulation, tracing, and cases where DOM actions are unreliable.",
      "Do not blindly replay a possibly completed write action through another backend; verify page state first when execution is uncertain.",
      "Prefer sanitized diagnostics before raw CDP events; screenshots are visible pixels and are not DOM-redacted.",
    ],
    workflows: {
      newPage: [
        "Call yunti_new_page with userId and optional current browserSessionId.",
        "Store the returned browserSessionId.",
        "Use that returned browserSessionId for navigate/evaluate/screenshot/close on the new tab.",
      ],
      closePage: [
        "If you have the target page's browserSessionId, call yunti_close_page with userId and that browserSessionId.",
        "If you only have tabId or targetId, use yunti_cdp_send_command routed through the current browserSessionId.",
      ],
      recoverRoute: [
        "Read the structured failure first. Retry only when retryable=true and never exceed retryBudget for the entire recovery chain.",
        "For YUNTI_SESSION_STALE, discard the stale id, call yunti_list_browser_targets once, and spend the single retry on the selected live page route.",
        "For YUNTI_EXTENSION_PROTOCOL_MISMATCH, do not call another browser tool until doctor reports matching runtime, extension, and protocol versions.",
        "For YUNTI_BRIDGE_RUNTIME_MISMATCH, restart the MCP/bridge process and run doctor; an old process owning the port cannot be repaired by retrying a page tool.",
        "Use the page browserSessionId when registered, or pass the returned tabId/targetId directly to the page tool for automatic registration.",
      ],
      evaluate: [
        "Use yunti_evaluate_script with expression.",
        "Use yunti_cdp_send_command Runtime.evaluate whenever CDP execution contexts, return options, isolated worlds, or protocol consistency make it the better path.",
      ],
      memoryDelete: [
        "Call yunti_get_learning_memory to find the id.",
        "Call yunti_forget_learning_memory with that id.",
      ],
      actionRecovery: [
        "For page actions, prefer observe -> act by fresh uid -> observe/verify.",
        "If an action fails with a stale or missing uid, refresh with yunti_observe_page before retrying.",
        "If the element may be outside the viewport, use observe scroll hints and yunti_scroll before falling back to coordinates.",
        "If the page is loading or changing, use yunti_wait_for or observe again instead of blind retries.",
        "For async UI transitions, use yunti_wait_for for expected text/selector/state, read ok/code/nextStepHint, then yunti_observe_page, then continue with a fresh uid instead of reusing the old target.",
        "If the target tab is uncertain, call yunti_list_browser_targets and use its page browserSessionId or tabId/targetId.",
        "Use selector or coordinate fallbacks only as recovery/debugging paths, not as the default when fresh uids are available.",
        "When DOM targeting or page events are unreliable, switch to yunti_cdp_send_command and use CDP DOM/Input/Runtime commands; CDP does not require extra user confirmation by itself.",
        "If a write action may already have happened but its result is uncertain, observe or inspect state before retrying through DOM or CDP.",
      ],
      defaultPageOperation: [
        "Call yunti_get_tool_usage_hints when tool usage is uncertain.",
        "Call yunti_list_browser_targets and choose the intended page browserSessionId or tabId/targetId.",
        "Call yunti_observe_page before page actions and use fresh uids whenever possible.",
        "Use yunti_find_elements when a smaller targeted candidate set is enough and you want to avoid a full-page observation.",
        "Select content-script actions or CDP based on expected reliability; switch to CDP freely when it offers better targeting, input, observation, or verification.",
        "After every action, verify by observing again or using snapshot, evaluate, screenshot, network, or console tools.",
        "For async rendering, validation, navigation, option loading, or infinite scroll, call yunti_wait_for, then yunti_observe_page, then continue with a fresh uid.",
        "If a result has ok=false, code, recoveryHint, or nextStepHint, follow that guidance before retrying.",
        "Use selector or coordinate fallback only when fresh uids are unavailable or as an explicit recovery/debugging path.",
      ],
      confirmationBoundary: [
        "Ask the user before submitting forms that change production data.",
        "Ask the user before deleting, approving, purchasing, publishing, or sending messages.",
        "Ask the user before uploading sensitive files.",
        "Ask the user before exposing or copying secrets, credentials, cookies, auth headers, tokens, or private keys.",
        "Ask the user before taking an action whose effect cannot be verified from page state.",
      ],
      copyableAgentPrompt: [
        "Please operate my browser through Yunti Browser Runtime.",
        "Call yunti_list_browser_targets, choose the intended page browserSessionId or tabId/targetId, then use yunti_observe_page before page actions.",
        "Prefer fresh uids for click, hover, fill, select, scroll, type, press, upload, and drag operations.",
        "After each action or wait, observe again and verify the result before continuing.",
        "For async UI, call yunti_wait_for, then yunti_observe_page, then continue with a fresh uid.",
        "If ok=false, code, recoveryHint, or nextStepHint appears, follow that guidance before retrying.",
        "If doctor shows only the browser controller online, pass the intended target tabId/targetId to observe/click/fill; the controller registers the page automatically.",
        "Use selector or coordinate fallback only as recovery/debugging paths.",
        "Ask me before submitting, deleting, approving, purchasing, publishing, uploading sensitive files, or changing production data.",
        "Do not expose raw cookies, passwords, auth headers, tokens, private keys, or other secrets.",
        "Use DOM actions and CDP as complementary first-class backends; choose whichever can complete and verify the task most reliably.",
        "Raw CDP event payloads and screenshots may contain sensitive data, so summarize safe findings and clear raw diagnostics after use.",
        "Do not repeat a possibly completed write action through another backend until page state has been checked.",
      ],
      minimalUseCases: {
        clickByUid: [
          "Call yunti_list_browser_targets and select the intended browserSessionId.",
          "Call yunti_observe_page and choose the target element uid from the fresh observation.",
          "Call yunti_click with browserSessionId and uid.",
          "Read ok, code, recoverable, recoveryHint, and nextStepHint; if recoverable, follow the hint before retrying.",
          "Call yunti_observe_page again or use screenshot/evaluate to verify the expected page change.",
        ],
        fillForm: [
          "Call yunti_observe_page and inspect field state: fillable, readOnly, disabled, fillBlockReason, selectedValue, selectedText, and options[].",
          "Fill editable fields with yunti_fill using fresh uids; select options with yunti_select using uid/value or uid/text.",
          "For multiple fields, use yunti_fill_form when fields are known and inspect per-field results[].",
          "If async validation or option loading occurs, call yunti_wait_for, then yunti_observe_page, then continue with fresh uids.",
          "Before submitting or changing production data, ask the user for confirmation.",
        ],
        scrollToFind: [
          "Call yunti_observe_page and inspect scrollableContainers[].",
          "Prefer yunti_scroll with a fresh scrollable container uid instead of document scroll for nested panels.",
          "After scrolling, call yunti_observe_page and search the new textTree/elements for the target.",
          "If moved=false, partialMovement, edgeHint, or recoveryHint appears, follow that guidance before repeating the same scroll.",
          "When async content loads after scrolling, call yunti_wait_for, then yunti_observe_page, then continue with a fresh scroll container uid.",
        ],
        switchTab: [
          "Call yunti_list_browser_targets to inspect current tabs and browser targets.",
          "Choose the intended browserSessionId for Yunti page tools.",
          "Use yunti_select_page when switching to a registered Yunti page route.",
          "Use yunti_cdp_send_command with Target.activateTarget only for raw targetId/tabId browser target activation.",
          "After switching, call yunti_observe_page or yunti_get_page_snapshot to verify the active page before acting.",
        ],
        waitForAsyncResult: [
          "Call yunti_wait_for with expected text, selector, or urlContains.",
          "If ok=true, call yunti_observe_page and use fresh uids for follow-up actions.",
          "If code=WAIT_TIMEOUT, observe or inspect current page state before adjusting the condition or retrying.",
          "Do not reuse pre-wait uids for newly rendered content.",
          "Verify the final result with observe, snapshot, evaluate, screenshot, network, or console tools.",
        ],
        findTargetedElement: [
          "Call yunti_find_elements with a query such as Save, Search, Submit, or a field label.",
          "Optionally narrow by role, tag, or placeholder when the page has many matches.",
          "Use the returned fresh uid for click/fill/select, then verify with yunti_observe_page or evaluate.",
          "If no result is returned, broaden the query, scroll, or fall back to yunti_observe_page.",
        ],
      },
      actionResultContract: [
        "Current action outputs are compatibility-shaped: click/hover/fill/scroll/wait may return clicked, hovered, filled, scrolled, found, uid, selector, x/y, method, valueLength, waitedMs, before/after, and browserSessionId depending on the tool path.",
        "P6.2 target shape should be additive and structured: action, browserSessionId, target, ok, code, recoverable, nextStepHint, and before/after summaries where useful.",
        "Do not remove existing success booleans or selector/coordinate fields while converging on the structured result contract.",
        "Treat successful dispatch as transport/action execution evidence, then verify page state with yunti_observe_page, yunti_get_page_snapshot, yunti_evaluate_script, screenshot, or CDP when the workflow needs proof.",
        "Recoverable failures should clearly point to observe, scroll, wait, switch tabs, selector/coordinate fallback, or asking the user.",
      ],
    },
    tools: selectedTools,
  }
}
