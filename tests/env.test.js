import { test } from "node:test";
import assert from "node:assert/strict";
import { detectEnv } from "../src/lib/env.js";

test("treats a local development host as local", () => {
  assert.equal(detectEnv("kaw", "localhost"), "local");
  assert.equal(detectEnv("kaw", "127.0.0.1"), "local");
  assert.equal(detectEnv("kaw", "kaw.localhost"), "local");
});

test("treats staging-like database or host names as staging", () => {
  assert.equal(detectEnv("kaw_staging", "erp.example.com"), "staging");
  assert.equal(detectEnv("kaw", "uat.example.com"), "staging");
  assert.equal(detectEnv("kaw-dev", "erp.example.com"), "staging");
});

test("treats everything else as production", () => {
  assert.equal(detectEnv("kaw_prod", "erp.example.com"), "prod");
  assert.equal(detectEnv("devonshire", "erp.example.com"), "prod");
});
