const { GoogleGenAI } = require("@google/genai")
const { z } = require("zod")
const { zodToJsonSchema } = require("zod-to-json-schema")
const puppeteer = require("puppeteer")

const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_GENAI_API_KEY
})


// =========================
// Retry Helper
// =========================

async function generateWithRetry(fn, retries = 3) {
    let lastError

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error

            const status =
                error?.status ||
                error?.code ||
                error?.response?.status

            const message = String(
                error?.message || ""
            ).toUpperCase()

            const retryable =
                status === 429 ||
                status === 503 ||
                status === "429" ||
                status === "503" ||
                status === "RESOURCE_EXHAUSTED" ||
                status === "UNAVAILABLE" ||
                message.includes("RESOURCE_EXHAUSTED") ||
                message.includes("UNAVAILABLE") ||
                message.includes("HIGH DEMAND")

            if (!retryable || attempt === retries - 1) {
                throw error
            }

            const delay =
                2000 * Math.pow(2, attempt)

            console.log(
                `Gemini request failed. Retry ${attempt + 1}/${retries - 1} in ${delay}ms...`
            )

            await new Promise(resolve =>
                setTimeout(resolve, delay)
            )
        }
    }

    throw lastError
}


// =========================
// Interview Report Schema
// =========================

const interviewReportSchema = z.object({

    matchScore: z.number()
        .min(0)
        .max(100)
        .describe(
            "A score between 0 and 100 indicating how well the candidate's profile matches the job description"
        ),

    technicalQuestions: z.array(
        z.object({
            question: z.string()
                .describe(
                    "The technical question that can be asked in the interview"
                ),

            intention: z.string()
                .describe(
                    "The intention of interviewer behind asking this question"
                ),

            answer: z.string()
                .describe(
                    "How to answer this question, what points to cover, what approach to take etc."
                )
        })
    ).describe(
        "Technical questions that can be asked in the interview along with their intention and how to answer them"
    ),

    behavioralQuestions: z.array(
        z.object({
            question: z.string()
                .describe(
                    "The behavioral question that can be asked in the interview"
                ),

            intention: z.string()
                .describe(
                    "The intention of interviewer behind asking this question"
                ),

            answer: z.string()
                .describe(
                    "How to answer this question, what points to cover, what approach to take etc."
                )
        })
    ).describe(
        "Behavioral questions that can be asked in the interview along with their intention and how to answer them"
    ),

    skillGaps: z.array(
        z.object({
            skill: z.string()
                .describe(
                    "The skill which the candidate is lacking"
                ),

            severity: z.enum([
                "low",
                "medium",
                "high"
            ]).describe(
                "The severity of this skill gap"
            )
        })
    ).describe(
        "List of skill gaps in the candidate's profile along with their severity"
    ),

    preparationPlan: z.array(
        z.object({
            day: z.number()
                .int()
                .positive()
                .describe(
                    "The day number in the preparation plan, starting from 1"
                ),

            focus: z.string()
                .describe(
                    "The main focus of this day in the preparation plan"
                ),

            tasks: z.array(z.string())
                .describe(
                    "List of tasks to be done on this day"
                )
        })
    ).describe(
        "A day-wise preparation plan for the candidate"
    ),

    title: z.string()
        .describe(
            "The title of the job for which the interview report is generated"
        )
})


// =========================
// Resume PDF Schema
// =========================

const resumePdfSchema = z.object({

    html: z.string()
        .describe(
            "The HTML content of the resume which can be converted to PDF using Puppeteer"
        )

})


// =========================
// Generate Interview Report
// =========================

async function generateInterviewReport({
    resume,
    selfDescription,
    jobDescription
}) {

    const prompt = `
You are an expert technical interviewer and career advisor.

Generate an interview preparation report for the candidate.

IMPORTANT:
- Use only information provided in the candidate data.
- Do not invent experience, projects, skills, education, certifications,
  achievements, or employment history.
- Analyze the candidate against the job description.
- Give practical and realistic interview preparation advice.

--- CANDIDATE RESUME ---
${resume}

--- CANDIDATE SELF DESCRIPTION ---
${selfDescription}

--- JOB DESCRIPTION ---
${jobDescription}

Generate the complete interview report according to the provided JSON schema.
`

    const response = await generateWithRetry(() =>
        ai.models.generateContent({

            // Use a model available in your Google AI account
            model: "gemini-3-flash-preview",

            contents: prompt,

            config: {
                responseMimeType: "application/json",

                responseSchema: zodToJsonSchema(
                    interviewReportSchema
                )
            }
        })
    )

    const result = JSON.parse(response.text)

    return interviewReportSchema.parse(result)
}


// =========================
// Generate PDF From HTML
// =========================

async function generatePdfFromHtml(htmlContent) {

    const browser = await puppeteer.launch()

    try {

        const page = await browser.newPage()

        await page.setContent(htmlContent, {
            waitUntil: "networkidle0"
        })

        const pdfBuffer = await page.pdf({

            format: "A4",

            printBackground: true,

            margin: {
                top: "20mm",
                bottom: "20mm",
                left: "15mm",
                right: "15mm"
            }
        })

        return pdfBuffer

    } finally {

        await browser.close()
    }
}


// =========================
// Generate Resume PDF
// =========================

async function generateResumePdf({
    resume,
    selfDescription,
    jobDescription
}) {

    const prompt = `
You are an expert professional resume writer.

Create a professional, ATS-friendly resume tailored specifically
to the provided job description.

IMPORTANT RULES:

1. Use only information available in the candidate data.
2. Do not invent companies, job titles, projects, skills, education,
   achievements, dates, certifications, or experience.
3. Highlight skills and experience that are genuinely relevant
   to the job description.
4. Keep the resume concise and ideally 1-2 pages.
5. Use professional human-written language.
6. Do not mention that AI was used.
7. Make the HTML clean and ATS-friendly.
8. Use simple professional styling.
9. Do not use JavaScript.
10. Do not use external resources or external scripts.
11. Return ONLY the HTML inside the "html" field.

--- CANDIDATE RESUME ---
${resume}

--- CANDIDATE SELF DESCRIPTION ---
${selfDescription}

--- JOB DESCRIPTION ---
${jobDescription}

Generate the resume according to the provided JSON schema.
`

    const response = await generateWithRetry(() =>
        ai.models.generateContent({

            // Use a model available in your Google AI account
            model: "gemini-3-flash-preview",

            contents: prompt,

            config: {
                responseMimeType: "application/json",

                responseSchema: zodToJsonSchema(
                    resumePdfSchema
                )
            }
        })
    )

    const jsonContent = JSON.parse(response.text)

    const validatedContent =
        resumePdfSchema.parse(jsonContent)

    const pdfBuffer =
        await generatePdfFromHtml(
            validatedContent.html
        )

    return pdfBuffer
}


// =========================
// Export
// =========================

module.exports = {
    generateInterviewReport,
    generateResumePdf
}
