import { expect, it } from "vitest";
import {
  replaceEmails,
  extractEmails,
  stripTrailingSlashes,
} from "../src/tracing/strings.js";

it("aliases addresses in prose and mailbox headers while preserving surrounding text", () => {
  expect(
    extractEmails("Alice <alice@example.test>, Bob <bob+tag@other.test>"),
  ).toEqual(["alice@example.test", "bob+tag@other.test"]);
  expect(
    replaceEmails(
      "Mail alice@example.test. Then bob@other.test!",
      () => "[person]",
    ),
  ).toBe("Mail [person]. Then [person]!");
});
it("handles repeated email-like delimiters in linear bounded work", () => {
  expect(extractEmails("!".repeat(200000))).toEqual([]);
  expect(extractEmails("a@".repeat(100000))).toEqual([]);
  expect(stripTrailingSlashes("https://api.test" + "/".repeat(200000))).toBe(
    "https://api.test",
  );
});
