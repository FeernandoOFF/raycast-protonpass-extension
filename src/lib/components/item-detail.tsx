import { Action, ActionPanel, Clipboard, Color, Detail, Icon, Keyboard, showToast, Toast } from "@raycast/api";
import { getPassClient } from "../pass/client";
import { ItemSummary } from "../pass/types";
import { DisplayItem, formatTotpCode, useItemDetail } from "../pass/useVaultItems";

// Actions for a lightweight list row. Secrets are fetched lazily only when an
// action is invoked (or the detail is opened) — never on render.
export function ItemSummaryActions(props: { summary: ItemSummary }) {
  const { summary } = props;

  return (
    <ActionPanel>
      <Action.Push icon={Icon.Sidebar} title="Open Details" target={<ItemDetailView summary={summary} />} />
      {summary.type === "Login" && summary.shareId && (
        <ActionPanel.Section>
          <Action
            icon={Icon.Key}
            title="Copy Password"
            shortcut={Keyboard.Shortcut.Common.Copy}
            onAction={() => copyLoginField(summary, "password")}
          />
          <Action
            icon={Icon.Clock}
            title="Copy TOTP"
            shortcut={{ modifiers: ["cmd"], key: "t" }}
            onAction={() => copyTotp(summary)}
          />
        </ActionPanel.Section>
      )}
      {summary.shareId && (
        <ActionPanel.Section>
          <Action.CopyToClipboard title="Copy Share ID" content={summary.shareId} />
        </ActionPanel.Section>
      )}
    </ActionPanel>
  );
}

// Action panel for a fully-loaded item (inside the detail view).
export function ItemActionPanel(props: { item: DisplayItem }) {
  const { item } = props;

  return (
    <ActionPanel>
      {item.clipboardElements.length > 0 && (
        <ActionPanel.Section>
          {item.clipboardElements.map((element, index) => (
            <Action.CopyToClipboard
              key={`${element.title}-${index}`}
              title={`Copy ${element.title}`}
              content={element.content}
              concealed={element.confidential}
              shortcut={shortcutForIndex(index)}
            />
          ))}
        </ActionPanel.Section>
      )}
      {item.type === "Login" && item.urls && item.urls.length > 0 && (
        <ActionPanel.Section>
          {item.urls.map((url, index) => (
            <Action.OpenInBrowser
              key={`${url}-${index}`}
              title={`Open ${url}`}
              url={url}
              shortcut={index === 0 ? { modifiers: ["cmd", "shift"], key: "o" } : undefined}
            />
          ))}
        </ActionPanel.Section>
      )}
      {item.shareId && (
        <ActionPanel.Section>
          <Action.CopyToClipboard title="Copy Share ID" content={item.shareId} />
        </ActionPanel.Section>
      )}
    </ActionPanel>
  );
}

export function ItemDetailView(props: { summary: ItemSummary }) {
  const { summary } = props;
  const { item, isLoading, remainingSeconds } = useItemDetail(summary);

  if (!item) {
    return (
      <Detail
        isLoading={isLoading}
        navigationTitle={summary.title}
        markdown={isLoading ? `# ${summary.title}\n\nLoading…` : `# ${summary.title}\n\nUnable to load this item.`}
      />
    );
  }

  const visibleFields = item.clipboardElements.filter(
    (field) => !(field.title === "Note" && field.content === item.notes),
  );

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={item.title}
      markdown={buildMarkdown(item.title, visibleFields, item.notes)}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Type" text={item.type === "Other" ? item.originalType : item.type} />
          <Detail.Metadata.Label title="Status" text={item.state} />
          {item.vaultTitle && <Detail.Metadata.Label title="Vault" text={item.vaultTitle} />}
          {item.totp && (
            <Detail.Metadata.TagList title="TOTP">
              <Detail.Metadata.TagList.Item
                text={formatTotpCode(item.totp)}
                color={remainingSeconds > 10 ? Color.Green : remainingSeconds > 5 ? Color.Yellow : Color.Red}
              />
              <Detail.Metadata.TagList.Item text={`${remainingSeconds}s`} />
            </Detail.Metadata.TagList>
          )}
          {item.createTime && <Detail.Metadata.Label title="Created" text={formatDate(item.createTime)} />}
          {item.modifyTime && <Detail.Metadata.Label title="Updated" text={formatDate(item.modifyTime)} />}
          {item.type === "Login" && item.urls && item.urls.length > 0 && <Detail.Metadata.Separator />}
          {item.type === "Login" &&
            item.urls?.map((url, index) => (
              <Detail.Metadata.Link key={`${url}-${index}`} title={`URL ${index + 1}`} text={url} target={url} />
            ))}
        </Detail.Metadata>
      }
      actions={<ItemActionPanel item={item} />}
    />
  );
}

// -- Lazy copy helpers for list rows

async function copyLoginField(summary: ItemSummary, field: "password") {
  if (!summary.shareId) return;
  try {
    const item = await getPassClient().getItem(summary.shareId, summary.id);
    const value = item?.type === "Login" ? item[field] : undefined;
    if (!value) {
      await showToast(Toast.Style.Failure, `No ${field} found`);
      return;
    }
    await Clipboard.copy(value, { concealed: true });
    await showToast(Toast.Style.Success, `Copied ${field}`);
  } catch (error) {
    await showToast(Toast.Style.Failure, `Failed to copy ${field}`, error instanceof Error ? error.message : undefined);
  }
}

async function copyTotp(summary: ItemSummary) {
  if (!summary.shareId) return;
  try {
    const code = await getPassClient().getItemTotp(summary.shareId, summary.id);
    if (!code) {
      await showToast(Toast.Style.Failure, "No TOTP found");
      return;
    }
    await Clipboard.copy(code, { concealed: true });
    await showToast(Toast.Style.Success, "Copied TOTP");
  } catch (error) {
    await showToast(Toast.Style.Failure, "Failed to copy TOTP", error instanceof Error ? error.message : undefined);
  }
}

function shortcutForIndex(index: number): Keyboard.Shortcut | undefined {
  if (index === 0) return { modifiers: ["cmd"], key: "c" };
  if (index === 1) return { modifiers: ["cmd", "shift"], key: "c" };
  if (index === 2) return { modifiers: ["cmd", "shift", "alt"], key: "c" };
  if (index === 3) return { modifiers: ["cmd", "shift", "alt", "ctrl"], key: "c" };
  return undefined;
}

function buildMarkdown(title: string, fields: DisplayItem["clipboardElements"], notes?: string) {
  const sections: string[] = [`# ${escapeMarkdown(title)}`];

  if (fields.length > 0) {
    sections.push("## Details");
    for (const field of fields) {
      sections.push(`### ${escapeMarkdown(field.title)}`);
      sections.push("```text");
      sections.push(displayValue(field));
      sections.push("```");
    }
  }

  if (notes) {
    sections.push("## Notes");
    sections.push(notes);
  }

  if (fields.length === 0 && !notes) {
    sections.push("No additional details available.");
  }

  return sections.join("\n\n");
}

function displayValue(field: DisplayItem["clipboardElements"][number]) {
  if (shouldMaskField(field)) {
    return maskValue(field.content);
  }

  return field.content;
}

function shouldMaskField(field: DisplayItem["clipboardElements"][number]) {
  return field.confidential || /email|alias/i.test(field.title);
}

function maskValue(value: string) {
  return "*".repeat(Math.max(8, Math.min(value.length, 16)));
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function formatDate(value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}
