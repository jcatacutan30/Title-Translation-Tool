require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk').default;
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Title Case utility (skips minor words except at start)
function toTitleCase(str) {
  const minorWords = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor',
    'on', 'at', 'to', 'by', 'in', 'of', 'with', 'from',
  ]);
  const words = str.split(/\s+/);
  return words
    .map((word, index) => {
      if (index !== 0 && minorWords.has(word.toLowerCase())) {
        return word.toLowerCase();
      }
      // Preserve abbreviations/acronyms (all uppercase)
      if (word.length > 1 && word === word.toUpperCase()) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function applyTitleCase(translations) {
  const result = {};
  for (const [lang, text] of Object.entries(translations)) {
    result[lang] = lang === 'JP' ? text : toTitleCase(text);
  }
  return result;
}

// Translate using Claude API
async function translateWithClaude(title) {
  const systemPrompt = `You are a multilingual SEO translation specialist.
Your task is to produce SEO-rich, market-localized translations for e-commerce product titles.
You emulate a native-level professional translator who is:
- Fluent in German (DE), French (FR), Italian (IT), Polish (PL), Dutch (NL), Swedish (SE), Spanish (ES), and Japanese (JP)
- Highly experienced in marketing copy, product descriptions, and Amazon-style listings
- Deeply knowledgeable in local SEO optimization, keyword intent, and search behavior per market

Rules:
- Translate for the LOCAL market, not word-for-word
- Use high-search-volume keywords natural to each language
- CRITICAL: You must identify EACH word in the title separately and decide whether it is descriptive or a proper noun/brand name:
  - Descriptive/common words MUST ALWAYS be translated. Examples: "Oversized" -> "Übergroß" (DE), "Surdimensionné" (FR), etc. Other examples: "Vintage", "Classic", "Premium", "Retro", "Logo", "Stripe", "Heritage", "Bold", "Original"
  - Proper nouns: team names ("Seahawks", "Patriots"), brand names ("Nike", "NFL"), city names ("Seattle", "Dallas"), and person names stay UNTRANSLATED in DE/IT/FR/PL/NL/SE/ES
  - Branded catchphrases or iconic slogans tied to a franchise (e.g. "Where Are You?" for Scooby-Doo, "To Infinity and Beyond") stay UNTRANSLATED in DE/IT/FR/PL/NL/SE/ES
  - Abbreviations (e.g. "NFL", "NBA", "NFC") always stay as-is in all languages
- Example: "Seahawks Oversized" -> keep "Seahawks" but translate "Oversized" -> DE: "Seahawks Übergroß", FR: "Seahawks Surdimensionné", etc.
- Example: "Seattle Seahawks" -> keep as "Seattle Seahawks" in all European languages (both are proper nouns)
- For Japanese (JP), output ONLY in katakana script. Translate ALL words (including brand names and proper nouns) into katakana, EXCEPT abbreviations which stay as-is (e.g. "NFL", "NFC")
- Keep translations concise and title-appropriate (no full sentences)
- Return ONLY valid JSON, no markdown, no explanation, no code fences`;

  const userPrompt = `Translate this product title into all 8 languages.
Return a JSON object with keys: DE, IT, FR, PL, NL, SE, ES, JP

Title: "${title}"`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let text = message.content[0].text.trim();

  // Strip markdown code fences if present
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  return JSON.parse(text);
}


// API endpoint
app.post('/api/translate', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const trimmedTitle = title.trim();

    // Step 1: Translate with Claude
    const translations = await translateWithClaude(trimmedTitle);

    // Step 2: Apply Title Case (skip JP)
    const titleCased = applyTitleCase(translations);

    res.json({
      original: trimmedTitle,
      translations: titleCased,
      sheetUpdated: false, // Legacy field kept for frontend compatibility
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});


// Bulk translate multiple items (with caching)
async function bulkTranslate(items) {
  const translationCache = new Map();
  const results = [];

  for (const item of items) {
    // Check cache for Design Family
    let familyTranslations;
    if (translationCache.has(item.lineupName)) {
      familyTranslations = translationCache.get(item.lineupName);
    } else {
      familyTranslations = await translateWithClaude(item.lineupName);
      familyTranslations = applyTitleCase(familyTranslations);
      translationCache.set(item.lineupName, familyTranslations);
    }

    // Check cache for Design Name
    let nameTranslations;
    if (translationCache.has(item.designName)) {
      nameTranslations = translationCache.get(item.designName);
    } else {
      nameTranslations = await translateWithClaude(item.designName);
      nameTranslations = applyTitleCase(nameTranslations);
      translationCache.set(item.designName, nameTranslations);
    }

    results.push({
      ...item,
      familyTranslations,
      nameTranslations,
    });
  }

  return results;
}

// Check for duplicate codes (Code must be unique per Lineup Name)
function checkDuplicates(products) {
  const seen = new Map(); // code -> lineupName
  const duplicates = [];

  for (const product of products) {
    // Corrected DC format: FamilyCode-DesignCode
    const code = `${product.familyCode}-${product.designCode}`;

    if (seen.has(code)) {
      const existingLineup = seen.get(code);
      // Only flag as duplicate if the Lineup Name is DIFFERENT
      if (existingLineup !== product.lineupName) {
        duplicates.push({
          code,
          first: existingLineup,
          duplicate: product.lineupName, // Show the conflicting lineup name
        });
      }
    } else {
      seen.set(code, product.lineupName);
    }
  }

  return duplicates;
}


// Helper to generate the 30-column block for a product
function generateProductBlock(product) {
  if (!product) {
    // Return 30 empty strings if no product matches
    return new Array(30).fill('');
  }

  const languages = ['DE', 'IT', 'FR', 'PL', 'NL', 'SE', 'ES', 'JP'];
  const familyCols = [];
  familyCols.push(product.familyTranslations['DE'] || ''); familyCols.push('');
  familyCols.push(product.familyTranslations['IT'] || ''); familyCols.push('');
  familyCols.push(product.familyTranslations['FR'] || ''); familyCols.push('');
  familyCols.push(product.familyTranslations['PL'] || ''); familyCols.push('');
  familyCols.push(product.familyTranslations['NL'] || ''); familyCols.push('');
  familyCols.push(product.familyTranslations['SE'] || ''); familyCols.push('');
  familyCols.push(product.familyTranslations['ES'] || ''); familyCols.push('');
  familyCols.push(product.familyTranslations['JP'] || ''); familyCols.push('');

  // Corrected DC format: FamilyCode-DesignCode
  const dc = `${product.familyCode}-${product.designCode}`;

  // Columns 1-30 construction
  return [
    dc,                                     // 1: DC
    product.lineupName,                     // 2: Lineup EN
    '',                                     // 3: Empty
    ...familyCols,                          // 4-19: Lineup Translations + gaps
    '',                                     // 20: Empty
    product.designName,                     // 21: Design EN
    ...languages.map(lang => product.nameTranslations[lang] || ''), // 22-29: Design Translations
    ''                                      // 30: Empty
  ];
}


// Parse brand/batch input like "NFL (BC #37, HB4 #37, HB1 #37, LB #37)"
function parseBrandBatchInput(input) {
  const match = input.match(/^([^(]+)\s*\(([^)]+)\)/);
  if (!match) {
    throw new Error('Invalid format. Expected: "BRAND (BC #XX, HB4 #XX, ...)"');
  }

  const brand = match[1].trim();
  const batchPart = match[2];

  // Extract batch codes like "BC #37", "HB4 #37", "LB #37"
  const batchCodes = batchPart.split(',').map(b => b.trim());

  // Separate BC-type (BC, HB4, HB1) from LB
  const bcBatches = [];
  const lbBatches = [];

  for (const code of batchCodes) {
    if (code.startsWith('LB')) {
      lbBatches.push(code);
    } else {
      bcBatches.push(code);
    }
  }

  return { brand, batchCodes, bcBatches, lbBatches };
}

// Parse pasted data from table/spreadsheet (tab-separated)
function parsePastedData(pastedText) {
  const lines = pastedText.trim().split(/\r?\n/);
  const products = [];

  for (const line of lines) {
    const columns = line.split('\t');
    if (columns.length < 2) continue; // Skip empty rows or single column noise

    // Batch | Lineup | Design Name | Designer | Family Code | Design Code | Label
    products.push({
      batch: columns[0]?.trim() || '',
      lineupName: columns[1]?.trim() || '',
      designName: columns[2]?.trim() || '',
      designer: columns[3]?.trim() || '',
      familyCode: columns[4]?.trim() || '',
      designCode: columns[5]?.trim() || '',
      finalCustomLabel: columns[6]?.trim() || '',
    });
  }

  return products;
}

// Paste-based batch processing endpoint
app.post('/api/process-paste', async (req, res) => {
  console.log('Processing paste request...');
  try {
    const { batchInput, pastedData } = req.body;

    if (!pastedData || !pastedData.trim()) {
      return res.status(400).json({ error: 'Pasted data is required' });
    }

    // Parse the brand/batch info if provided
    let brand = 'Unknown';
    let bcBatches = [];
    let lbBatches = [];

    if (batchInput && batchInput.trim()) {
      try {
        const parsed = parseBrandBatchInput(batchInput.trim());
        brand = parsed.brand;
        bcBatches = parsed.bcBatches;
        lbBatches = parsed.lbBatches;
      } catch (e) {
        // Ignore parsing errors
      }
    }

    // Parse pasted data
    const products = parsePastedData(pastedData);
    if (products.length === 0) {
      return res.status(400).json({ error: 'No valid product rows found' });
    }

    // Translate all products first
    const translatedProducts = await bulkTranslate(products);

    // Separate BC and LB products (based on HLBWH in final Custom Label)
    const bcProducts = translatedProducts.filter(p => !p.finalCustomLabel.includes('HLBWH'));
    const lbProducts = translatedProducts.filter(p => p.finalCustomLabel.includes('HLBWH'));

    // Auto-generate LB if needed (LB batches exist but no LB rows found)
    let finalLbProducts = [...lbProducts];

    if (lbProducts.length === 0 && lbBatches.length > 0 && bcProducts.length > 0) {
      // Derive LB from BC
      finalLbProducts = bcProducts.map(p => {
        // Clone and modify DC (append L to design code for LB version, assumption)
        return {
          ...p,
          designCode: 'L' + p.designCode // Simple prepend L logic for derived codes
        };
      });
    }

    // Generate Blocks
    const bcRows = bcProducts.map(p => {
      const row = generateProductBlock(p);
      return { row, tabSeparated: row.join('\t') };
    });

    const lbRows = finalLbProducts.map(p => {
      const row = generateProductBlock(p);
      return { row, tabSeparated: row.join('\t') };
    });

    // Construct Combined Output
    let finalRows = [];
    let outputTextParts = [];

    const bcHeader = `${brand} (${bcBatches.join(', ')})`;
    const lbHeader = `${brand} (${lbBatches.join(', ')})`;

    // 1. BC Section
    if (bcRows.length > 0 || bcBatches.length > 0) {
      // Header Row
      // For 'rows' (UI table), we create a special row or just a regular row?
      // UI expects 'row' (array) in 'bcRows' format.
      // We'll create a row where first column is header, others empty.
      const headerRow = [bcHeader, ...new Array(29).fill('')];
      finalRows.push({ row: headerRow, isHeader: true });

      outputTextParts.push(bcHeader);

      // Data Rows
      bcRows.forEach(r => {
        finalRows.push(r);
        outputTextParts.push(r.tabSeparated);
      });
    }

    // 2. LB Section (appended below)
    if (lbRows.length > 0 || lbBatches.length > 0) {
      // Separator between sections if needed? Usually just the next header.

      // Header Row
      const headerRow = [lbHeader, ...new Array(29).fill('')];
      finalRows.push({ row: headerRow, isHeader: true });

      outputTextParts.push(lbHeader);

      // Data Rows
      lbRows.forEach(r => {
        finalRows.push(r);
        outputTextParts.push(r.tabSeparated);
      });
    }

    const finalOutputText = outputTextParts.join('\n');

    res.json({
      brand,
      bcBatches,
      lbBatches,
      totalGroups: bcProducts.length + finalLbProducts.length,
      duplicates: checkDuplicates(products),
      outputText: finalOutputText,
      rows: finalRows,
      headerString: bcHeader // Main info
    });

  } catch (err) {
    console.error('Paste processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Title Translation Tool running at http://localhost:${PORT}`);
});
