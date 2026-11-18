/** Linear scans on provider-controlled strings; avoid regex restart backtracking. */
export function stripTrailingSlashes(text: string): string {
  let end = text.length;
  while (end && text[end - 1] === "/") end--;
  return text.slice(0, end);
}
const LOCAL = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.!#$%&'*+/=?^_`{|}~-",
);
const DOMAIN = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-",
);
const DOTS = new Set([".", "\u3002", "\uff0e", "\uff61"]);
const UNICODE_WORD = /^[\p{L}\p{M}\p{N}]$/u;
function previous(text: string, index: number): number {
  const last = text.charCodeAt(index - 1);
  return last >= 0xdc00 &&
    last <= 0xdfff &&
    index > 1 &&
    text.charCodeAt(index - 2) >= 0xd800 &&
    text.charCodeAt(index - 2) <= 0xdbff
    ? index - 2
    : index - 1;
}
function next(text: string, index: number): number {
  return index + (text.codePointAt(index)! > 0xffff ? 2 : 1);
}
export function replaceEmails(
  text: string,
  replace: (email: string) => string,
): string {
  const chunks: string[] = [];
  let cursor = 0,
    copied = 0;
  while (cursor < text.length) {
    const at = text.indexOf("@", cursor);
    if (at < 0) break;
    let start = at,
      end = at + 1;
    while (start > copied) {
      const before = previous(text, start),
        char = text.slice(before, start);
      if (!LOCAL.has(char) && !UNICODE_WORD.test(char)) break;
      start = before;
    }
    // Conservatively mask a whole ambiguous multi-@ token, without swallowing
    // surrounding Unicode punctuation, quotes or prose.
    while (end < text.length) {
      const after = next(text, end),
        char = text.slice(end, after);
      if (
        !DOMAIN.has(char) &&
        !DOTS.has(char) &&
        char !== "@" &&
        !UNICODE_WORD.test(char)
      )
        break;
      end = after;
    }
    while (end > at + 1 && DOTS.has(text[end - 1])) end--;
    const domain = text
        .slice(text.lastIndexOf("@", end - 1) + 1, end)
        .replace(/[\u3002\uff0e\uff61]/g, "."),
      dot = domain.lastIndexOf(".");
    if (start < at && dot > 0 && /^[\p{L}\p{M}]/u.test(domain.slice(dot + 1))) {
      chunks.push(text.slice(copied, start), replace(text.slice(start, end)));
      copied = end;
    }
    cursor = Math.max(at + 1, end);
  }
  chunks.push(text.slice(copied));
  return chunks.join("");
}
export function extractEmails(text: string): string[] {
  const emails: string[] = [];
  replaceEmails(text, (email) => {
    emails.push(email);
    return "";
  });
  return emails;
}
