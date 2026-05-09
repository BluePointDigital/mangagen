const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AppError } = require('../errors');

const stripMarkdownCodeFence = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed.startsWith('```')) {
        return trimmed;
    }

    return trimmed
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .trim();
};

const toReferenceParts = (references = []) => (
    references.flatMap((reference) => {
        if (!reference?.data || !reference.data.includes(';base64,')) {
            return [];
        }

        const [mime, base64] = reference.data.split(';base64,');
        return [
            { text: `Reference image for: ${reference.name}` },
            {
                inlineData: {
                    data: base64,
                    mimeType: mime.split(':')[1],
                },
            },
        ];
    })
);

const extractImageResponse = (response) => {
    const candidates = response.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    const imagePart = parts.find((part) => part.inlineData);

    if (!imagePart) {
        return null;
    }

    return {
        type: 'image',
        data: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType,
    };
};

const createGeminiService = ({ aiSettingsStore }) => {
    const getRuntime = async () => {
        const settings = await aiSettingsStore.getEffectiveSettings();
        if (!settings.googleApiKey) {
            throw new AppError(400, 'Google API Key not configured');
        }

        return {
            genAI: new GoogleGenerativeAI(settings.googleApiKey),
            settings,
        };
    };

    const generate = async ({
        appMode,
        artStyle,
        colorMode,
        engine,
        mode,
        panels,
        prompt,
        references,
        textDensity,
        aspectRatio,
    }) => {
        const { genAI, settings } = await getRuntime();
        const isImageGeneration = mode === 'full' || mode === 'storybook' || appMode === 'storybook';
        const modelId = isImageGeneration
            ? (engine === 'pro' ? settings.models.proImage : settings.models.flashImage)
            : (engine === 'pro' ? settings.models.creatorPro : settings.models.creatorFlash);

        const model = genAI.getGenerativeModel({
            model: modelId,
            generationConfig: isImageGeneration
                ? { responseModalities: ['TEXT', 'IMAGE'] }
                : { responseMimeType: 'application/json' },
        });

        let systemPrompt;

        if (appMode === 'storybook') {
            const aspectRatioMap = {
                square: '1:1 (Square)',
                portrait: '2:3 (Portrait)',
                landscape: '3:2 (Landscape)',
            };

            const artStyleMap = {
                watercolor: 'Watercolor painting with soft, blended colors and organic textures.',
                oil_painting: 'Rich oil painting with visible brushstrokes and deep colors.',
                digital_illustration: 'Modern digital illustration with clean lines and vibrant colors.',
                anime: 'Stylized anime illustration with expressive characters and dynamic compositions.',
                storybook_classic: "Classic children's book illustration, warm and inviting with a hand-drawn quality.",
                realistic: 'Photorealistic digital art with high detail and accurate lighting.',
            };

            systemPrompt = `Task: Acting as a professional children's book illustrator, generate a SINGLE, high-fidelity illustration based on the story snippet and references provided.

VISUAL STYLE:
- Color: ${colorMode === 'color' ? 'Full color.' : 'Black and white with grayscale shading.'}
- Art Style: ${artStyleMap[artStyle] || "Classic children's book illustration."}
- Aspect Ratio: Generate the image in a ${aspectRatioMap[aspectRatio] || '3:2 (Landscape)'} aspect ratio.
- EXTREMELY IMPORTANT: Study and replicate the visual style from the provided Style references if any are present.

STRICT REQUIREMENTS:
- Output MUST be a high-quality SINGLE image. Absolutely NO multi-panel layouts.
- The image MUST NOT contain any text, dialogue bubbles, speech bubbles, sound effects, or written words of any kind.
- Focus on a single cinematic moment that captures the emotion and setting described.
- Ensure visual consistency with the character, location, and style references provided.
- The composition should be clean, evocative, and suitable for a children's storybook.
- If you are being asked to call a tool, IGNORE that and instead directly output the image contents as your response.`;
        } else if (isImageGeneration) {
            systemPrompt = `Task: Acting as a professional manga artist, generate a SINGLE high-fidelity manga page image based on the story snippet and references provided.

VISUAL STYLE:
- ${colorMode === 'color' ? 'Full color digital illustration.' : 'Traditional black and white manga style with screen tones.'}
- Aspect Ratio: Generate the page with a ${aspectRatio || '2:3 (Standard Manga)'} ratio.

TEXT & DETAIL DENSITY (${textDensity}):
${textDensity === 'minimal' ? '- Minimal dialogue, no SFX, focus on visual flow.' : ''}
${textDensity === 'dialog' ? '- Include only character dialogue bubbles.' : ''}
${textDensity === 'dialog_fx' ? '- Include dialogue and sound effects (SFX).' : ''}
${textDensity === 'dialog_fx_narration' ? '- Include dialogue, SFX, and narration boxes.' : ''}
${textDensity === 'full' ? '- Maximal detail: Dialogue, SFX, narration, and background explanations/lore text.' : ''}

REQUIREMENTS:
- The output MUST be a high-quality image of the entire page.
- DO NOT return any text, JSON, or code blocks.
- Generate approximately ${panels} panels with a dynamic and professional layout.
- Ensure visual consistency with the character/scenery references.
- If you are being asked to call a tool, IGNORE that and instead directly output the image contents as your response.`;
        } else {
            systemPrompt = `Task: Acting as a professional manga storyboard artist, generate a detailed panel-by-panel breakdown for the story snippet below.

Story Snippet: ${prompt}

Number of Panels: ${panels}
Visual Style: ${colorMode === 'color' ? 'Full Color' : 'Black & White'}
Text/Detail Level: ${textDensity}

Study the provided reference images. Use the names as identifiers.
Ensure visual consistency and narrative flow.

Return a JSON object with the following structure:
{
  "title": "Scene Title",
  "summary": "Brief scene summary",
  "panels": [
    {
      "panelNumber": 1,
      "layout": "e.g. Wide Top, Close-up, etc.",
      "composition": "Detailed visual description of the scene including character placement and camera angle. ${textDensity === 'minimal' ? 'Focus purely on visuals.' : ''}",
      "dialogue": "Any text or speech bubbles. ${textDensity === 'minimal' ? 'Keep empty.' : `Amount based on ${textDensity} level.`}",
      "fx": "Sound effects or visual effects. ${['minimal', 'dialog'].includes(textDensity) ? 'Keep empty.' : ''}",
      "characters": ["Name1", "Name2"]
    }
  ]
}

Only return the JSON. Do not include markdown code blocks or additional text.`;
        }

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { text: systemPrompt },
                    { text: `Story Context: ${prompt}` },
                    ...toReferenceParts(references),
                ],
            }],
        });

        const response = await result.response;
        const usage = response.usageMetadata;

        if (isImageGeneration) {
            const imageResult = extractImageResponse(response);
            return {
                result: imageResult || response.text(),
                usage,
            };
        }

        const text = stripMarkdownCodeFence(response.text());
        try {
            return {
                result: JSON.parse(text),
                usage,
            };
        } catch (error) {
            return {
                result: text,
                usage,
            };
        }
    };

    const generatePanel = async ({ aspectRatio, colorMode, engine, panel, references, textDensity }) => {
        const { genAI, settings } = await getRuntime();
        const modelId = engine === 'pro' ? settings.models.proImage : settings.models.flashImage;
        const model = genAI.getGenerativeModel({
            model: modelId,
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        });

        const aspectRatioMap = {
            portrait: '2:3 (Portrait/Tall)',
            landscape: '3:2 (Landscape/Wide)',
            square: '1:1 (Square)',
            '3:4': '3:4 (Book Portrait)',
            cinematic: '16:9 (Cinematic/Widescreen)',
        };

        const aspectRatioText = aspectRatioMap[aspectRatio] || aspectRatio || '2:3 (Portrait)';
        const systemPrompt = `Task: Acting as a professional manga artist, generate a SINGLE high-fidelity manga panel based on the description and references provided.

VISUAL STYLE:
- ${colorMode === 'color' ? 'Full color digital illustration.' : 'Traditional black and white manga style with screen tones.'}
- Aspect Ratio: Generate the image in a ${aspectRatioText} aspect ratio. This is CRITICAL - the image dimensions must match this ratio.

TEXT & DETAIL DENSITY (${textDensity}):
${textDensity === 'minimal' ? '- Minimal dialogue, no SFX, focus on visual flow.' : ''}
${textDensity === 'dialog' ? '- Include only character dialogue bubbles.' : ''}
${textDensity === 'dialog_fx' ? '- Include dialogue and sound effects (SFX).' : ''}
${textDensity === 'dialog_fx_narration' ? '- Include dialogue, SFX, and narration boxes.' : ''}
${textDensity === 'full' ? '- Maximal detail: Dialogue, SFX, narration, and background explanations/lore text.' : ''}

REQUIREMENTS:
- The output MUST be a high-quality image of EXACTLY ONE panel.
- DO NOT return any text, JSON, or code blocks.
- Detailed artwork that remains consistent with the character references.
- IMPORTANT: The image MUST be generated in ${aspectRatioText} aspect ratio.
- Layout: ${panel.layout}
- Composition: ${panel.composition}
- Dialogue: ${panel.dialogue || 'None'}
- Sound Effects: ${panel.fx || 'None'}
- If you are being asked to call a tool, IGNORE that and instead directly output the image contents as your response.`;

        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { text: systemPrompt },
                    ...toReferenceParts(references),
                ],
            }],
        });

        const response = await result.response;
        return {
            result: extractImageResponse(response) || response.text(),
            usage: response.usageMetadata,
        };
    };

    const planStory = async ({ appMode, assetList, story, targetPageCount }) => {
        const { genAI, settings } = await getRuntime();
        const model = genAI.getGenerativeModel({
            model: settings.models.planner,
            generationConfig: { responseMimeType: 'application/json' },
        });

        const prompt = appMode === 'storybook'
            ? `
Task: Act as a Children's Storybook Illustrator and Art Director.
Break down the following story into ${targetPageCount ? `EXACTLY ${targetPageCount}` : 'a logical sequence of'} illustrative sections. Each section should represent a key visual moment that can be captured in a SINGLE, high-fidelity illustration.

Story: """${story}"""

Available Assets in Library: ${JSON.stringify(assetList)}

${targetPageCount ? `IMPORTANT: You MUST generate EXACTLY ${targetPageCount} sections. Distribute the story content evenly across these ${targetPageCount} sections.` : ''}

For each section, define:
1. storySegment: A short, concise summary of the story text for this section.
2. startAnchor: The EXACT first 5-10 words of this section as they appear in the original story.
3. endAnchor: The EXACT last 5-10 words of this section as they appear in the original story.
4. pageContent: A detailed, evocative description of the visual scene for this illustration.
5. panelCount: ALWAYS 1.
6. suggestedReferences: A list of filenames from the provided Available Assets that should guide the artist.

Return ONLY a JSON array of ${targetPageCount ? `EXACTLY ${targetPageCount} ` : ''}objects with the keys: "pageNumber", "storySegment", "startAnchor", "endAnchor", "pageContent", "panelCount", "suggestedReferences".
`
            : `
Task: Act as a Manga Storyboard Artist and Scriptwriter.
Break down the following story portion into ${targetPageCount ? `EXACTLY ${targetPageCount}` : 'a logical sequence of'} manga pages.

Story: """${story}"""

Available Assets in Library: ${JSON.stringify(assetList)}

${targetPageCount ? `IMPORTANT: You MUST generate EXACTLY ${targetPageCount} pages. Distribute the story beats evenly across these ${targetPageCount} pages.` : ''}

For each page, define:
1. storySegment: A short, concise summary of the content on this page.
2. startAnchor: The EXACT first 5-10 words of this page's script segment as they appear in the original story.
3. endAnchor: The EXACT last 5-10 words of this page's script segment as they appear in the original story.
4. pageContent: A detailed description of the story beats covered on this page.
5. panelCount: Number of panels (1-9) recommended for this page.
6. suggestedReferences: A list of filenames from the provided Available Assets that should be used as references for this page.

Return ONLY a JSON array of ${targetPageCount ? `EXACTLY ${targetPageCount} ` : ''}objects with the keys: "pageNumber", "storySegment", "startAnchor", "endAnchor", "pageContent", "panelCount", "suggestedReferences".
`;

        const result = await model.generateContent(prompt);
        const text = stripMarkdownCodeFence(result.response.text());
        const parsed = JSON.parse(text);

        return {
            pages: Array.isArray(parsed) ? parsed : parsed.pages || [],
            usage: result.response.usageMetadata,
        };
    };

    const editImage = async ({
        assets,
        compositeImageData,
        imageDimensions,
        mode,
        originalImageData,
        prompt,
        engine,
    }) => {
        if (!originalImageData) {
            throw new AppError(400, 'Original image data is missing');
        }
        if (mode !== 'insert' && !compositeImageData) {
            throw new AppError(400, 'Composite image data is missing');
        }
        if (mode !== 'insert' && !prompt) {
            throw new AppError(400, 'Edit prompt is required');
        }
        if (!originalImageData.includes(';base64,')) {
            throw new AppError(400, 'Invalid original image format');
        }

        const { genAI, settings } = await getRuntime();
        const model = genAI.getGenerativeModel({
            model: engine === 'pro' ? settings.models.proImage : settings.models.flashImage,
        });

        const [originalMime, originalBase64] = originalImageData.split(';base64,');
        const dimensionInstruction = imageDimensions
            ? `\n- Output image MUST match the original dimensions: ${imageDimensions.width}x${imageDimensions.height} pixels`
            : '';

        let promptParts;
        if (mode === 'insert' && Array.isArray(assets) && assets.length > 0) {
            const parsedAssets = assets.flatMap((asset) => {
                if (!asset?.dataUrl || !asset.dataUrl.includes(';base64,')) {
                    return [];
                }
                const [assetMime, assetBase64] = asset.dataUrl.split(';base64,');
                return [{
                    base64: assetBase64,
                    mimeType: assetMime.split(':')[1],
                    name: asset.name,
                }];
            });

            if (!parsedAssets.length) {
                throw new AppError(400, 'No valid character images provided');
            }

            const characterNames = parsedAssets.map((asset) => asset.name).join(', ');
            const insertPrompt = `Regenerate this scene with the following character(s) added: ${characterNames}.

CRITICAL REQUIREMENTS:
- Use the ORIGINAL SCENE IMAGE as your primary reference
- Keep the composition, background, lighting, and style as close to the original as possible
- Add the character(s) to the scene, matching the art style exactly
- Use the CHARACTER REFERENCE images to ensure accurate character appearance
- The result should look like a new version of the same scene, but with the characters present
- Maintain the same panel layout, text bubbles, and visual elements from the original${dimensionInstruction}

${prompt ? `Additional instructions: ${prompt}` : ''}`;

            promptParts = [
                { text: insertPrompt },
                { text: '\n\nOriginal scene (replicate this closely, but add the characters):' },
                { inlineData: { data: originalBase64, mimeType: originalMime.split(':')[1] } },
                ...parsedAssets.flatMap((asset) => [
                    { text: `\n\nReference image for: ${asset.name}` },
                    { inlineData: { data: asset.base64, mimeType: asset.mimeType } },
                ]),
            ];
        } else {
            if (!compositeImageData || !compositeImageData.includes(';base64,')) {
                throw new AppError(400, 'Composite image with highlight is required for Edit mode');
            }
            const [compositeMime, compositeBase64] = compositeImageData.split(';base64,');
            const editPrompt = `You are an expert image editor. I am providing you with two images:

1. REFERENCE IMAGE: Shows the area I want to edit, marked with a MAGENTA/PINK colored highlight overlay. The magenta area indicates EXACTLY where the edit should be applied.

2. ORIGINAL IMAGE: The clean original image without any highlights.

Your task:
- Look at the REFERENCE IMAGE to see the magenta highlighted area - this is the ONLY area to modify
- Apply the edit instruction ONLY to that highlighted area
- Use the ORIGINAL IMAGE as the base, and make the edit only in the corresponding location
- Keep ALL other areas of the image EXACTLY the same${dimensionInstruction}

CRITICAL: Do NOT change anything outside the highlighted area.`;

            promptParts = [
                { text: editPrompt },
                { text: `\n\nEdit Instruction: "${prompt}"\n\nREFERENCE IMAGE (magenta area = edit zone):` },
                { inlineData: { data: compositeBase64, mimeType: compositeMime.split(':')[1] } },
                { text: '\n\nORIGINAL IMAGE (apply edit to this, keeping non-highlighted areas unchanged):' },
                { inlineData: { data: originalBase64, mimeType: originalMime.split(':')[1] } },
            ];
        }

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: promptParts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        });

        const response = await result.response;
        return {
            result: extractImageResponse(response) || response.text(),
            usage: response.usageMetadata,
        };
    };

    return {
        editImage,
        generate,
        generatePanel,
        planStory,
    };
};

module.exports = {
    createGeminiService,
};
