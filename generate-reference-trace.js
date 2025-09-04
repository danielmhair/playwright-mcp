#!/usr/bin/env node

/**
 * Generate a reference trace with proper locator actions for comparison
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function generateReferenceTrace() {
  console.log('🔍 Generating reference trace with proper locator actions...');

  const outputDir = path.join(process.cwd(), 'playwright-mcp-output', 'reference-trace');
  await fs.promises.mkdir(outputDir, { recursive: true });
  
  const tracePath = path.join(outputDir, 'reference.zip');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  
  // Start tracing
  await context.tracing.start({
    name: 'reference-trace',
    screenshots: true,
    snapshots: true,
    sources: true,
  });

  const page = await context.newPage();
  
  // Navigate to example.com (same as our test)
  await page.goto('https://example.com');
  
  // Wait a moment
  await page.waitForTimeout(1000);
  
  // Perform some locator actions
  await page.locator('h1').click();
  await page.locator('a').hover();
  await page.locator('p').first().focus();
  
  // Stop tracing
  await context.tracing.stop({ path: tracePath });
  
  await browser.close();
  
  console.log(`✅ Reference trace generated: ${tracePath}`);
  
  // Extract and examine the trace file
  const traceDir = path.join(outputDir, 'extracted');
  await fs.promises.mkdir(traceDir, { recursive: true });
  
  // Unzip the trace file to examine contents
  console.log('📂 Extracting trace for analysis...');
  
  return tracePath;
}

generateReferenceTrace().catch(console.error);