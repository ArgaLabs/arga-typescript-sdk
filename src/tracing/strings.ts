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
    while (start > copied && LOCAL.has(text[start - 1])) start--;
    while (end < text.length && DOMAIN.has(text[end])) end++;
    // Trim sentence punctuation; require a plausible domain suffix.
    while (end > at + 1 && text[end - 1] === ".") end--;
    const domain = text.slice(at + 1, end),
      dot = domain.lastIndexOf(".");
    if (start < at && dot > 0 && /^[A-Za-z]{2}/.test(domain.slice(dot + 1))) {
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
