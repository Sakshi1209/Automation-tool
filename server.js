const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const { faker } = require('@faker-js/faker'); // Faker.js for unique data generation

const app = express();
const PORT = 3000;

app.use(cors()); 
app.use(express.json()); 

// --------------------------------------------------------
// 💡 UNIQUE DATA GENERATOR
// --------------------------------------------------------
function generateRandomData() {
    const uniqueId = faker.string.uuid().substring(0, 8);
    const dateOfBirth = faker.date.birthdate({ min: 18, max: 65, mode: 'age' });
    
    // Format the date correctly for HTML input type="date"
    const dobString = `${dateOfBirth.getFullYear()}-${String(dateOfBirth.getMonth() + 1).padStart(2, '0')}-${String(dateOfBirth.getDate()).padStart(2, '0')}`;
    
    return {
        // Page 1 Fields 
        firstname: faker.person.firstName(), 
        lastname: faker.person.lastName(),
        dob: dobString,
        email: `test.${uniqueId}@${faker.internet.domainName()}`,
        address: faker.location.streetAddress(),
        message: `Automated submission at ${new Date().toLocaleTimeString()} (Job ID: ${uniqueId})`,
        
        // Page 2 Fields (Assumed/Simulated)
        companyName: faker.company.name() + ' Solutions', 
        position: faker.person.jobTitle(),
    };
}
// --------------------------------------------------------


// --- MOCK LLM Client (INTELLIGENCE LAYER) ---
let mockCallCount = 0; 

// The LLM's role is to act as the AI scanner, providing the map for the current page context.
async function getAiMapping(html, applicationData) {
    mockCallCount++;
    console.log(`Mocking LLM analysis (Call #${mockCallCount})`);
    
    if (mockCallCount === 1) {
        // Page 1 Map (Personal Details)
        return {
            field_map: [
                { "data_key": "firstname", "selector": "input[name='firstname']", "html_type": "text" }, 
                { "data_key": "lastname", "selector": "input[name='lastname']", "html_type": "text" },
                { "data_key": "dob", "selector": "input[name='dob']", "html_type": "date" },
                { "data_key": "email", "selector": "input[name='email']", "html_type": "email" },
                { "data_key": "address", "selector": "input[name='address']", "html_type": "text" },
                { "data_key": "message", "selector": "textarea[name='message']", "html_type": "textarea" },
            ],
            next_button_selector: ".formbold-btn",
            is_final_step: false
        };
    } else if (mockCallCount === 2) {
        // Page 2 Map (Company Info)
        console.log("--- AI detected Page 2 fields (Company Info) ---");
        return {
            field_map: [
                { "data_key": "companyName", "selector": "input[name='companyName']", "html_type": "text" }, 
                { "data_key": "position", "selector": "input[name='position']", "html_type": "text" },
            ],
            next_button_selector: ".formbold-btn",
            is_final_step: true 
        };
    } else {
        // Form End
        console.log("--- AI found no more relevant fields. ---");
        return { field_map: [], next_button_selector: null, is_final_step: false };
    }
}
// ---------------------------------------------


// --- Puppeteer Automation Logic ---
async function automateForm(url, applicationData) {
    // Reset the mock counter for each new job
    mockCallCount = 0; 
    let browser;
    let page;
    
    try {
        browser = await puppeteer.launch({ headless: true });
        page = await browser.newPage();
        
        console.log(`Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0' });

        let fieldsProcessedTotal = 0;
        let shouldContinue = true;

        while (shouldContinue) {
            let currentHtml = await page.content();
            let llmMap = await getAiMapping(currentHtml, applicationData); // AI provides the dynamic map

            if (!llmMap || !llmMap.field_map || llmMap.field_map.length === 0) {
                console.log("AI returned no fields or map. Exiting loop.");
                shouldContinue = false;
                break;
            }

            // 1. Fill Fields based on LLM Map
            for (const field of llmMap.field_map) {
                const selector = field.selector;
                const value = applicationData[field.data_key];
                const type = field.html_type;

                if (!value) continue;

                try {
                    console.log(`ATTEMPTING to fill [${field.data_key}] using selector: ${selector}`); 
                    await page.waitForSelector(selector, { timeout: 10000 }); 

                    // Filling logic (using final reliable method: evaluate + focus/blur)
                    if (type === 'radio' || type === 'checkbox') {
                         await page.click(selector);
                    } else if (type === 'select') {
                        await page.select(selector, value);
                    } else {
                        // Inject JavaScript to set value directly and dispatch events
                        await page.evaluate((sel, val) => {
                            const element = document.querySelector(sel);
                            if (element) {
                                element.focus(); 
                                element.value = val;
                                element.dispatchEvent(new Event('input', { bubbles: true }));
                                element.dispatchEvent(new Event('change', { bubbles: true }));
                                element.blur(); 
                            }
                        }, selector, value);
                    }
                    
                    console.log(`SUCCESS: Filled ${field.data_key}.`); 
                    fieldsProcessedTotal++; 
                } catch (e) {
                    console.warn(`FAILURE: Selector [${selector}] for ${field.data_key} not found on page. Skipping.`);
                }
            }
            
            // 2. Click the Navigation Button
            const navSelector = llmMap.next_button_selector;
            if (!navSelector) {
                shouldContinue = false;
                break; 
            }
            
            // Add a slight pause to allow the form's internal validation script to run before clicking.
            await new Promise(resolve => setTimeout(resolve, 500)); 

            console.log(`\nATTEMPTING NAVIGATION with selector: ${navSelector}`);
            
            try {
                await page.waitForSelector(navSelector, { timeout: 10000 }); 
                
                // Use page.evaluate to click the button and prevent default navigation behavior
                await page.evaluate((selector) => {
                    const button = document.querySelector(selector);
                    if (button) {
                        button.removeAttribute('target'); // Prevents opening in a new tab
                        button.click();
                        return true;
                    }
                    return false;
                }, navSelector);
                
                console.log(`SUCCESS: Clicked navigation button via evaluation.`);

            } catch (e) {
                throw new Error(`Navigation element not found: ${navSelector}. Error: ${e.message}`);
            }
            
            // 3. Conditional Wait: Check if this was the final step
            if (llmMap.is_final_step) {
                console.log("Final submission detected. Waiting for response...");
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });
                shouldContinue = false;
                break;
            } else {
                // If NOT final submission, wait for the first element of the next section to appear.
                // NOTE: This selector must match the first element of the next step (mockCallCount 2)
                const next_page_wait_selector = "input[name='companyName']"; 
                console.log(`Waiting for next section element: ${next_page_wait_selector}`);
                
                await page.waitForSelector(next_page_wait_selector, { timeout: 15000 }); 
            }
            // Loop continues for the next step (Call #2)
        }
        
        await browser.close();
        return `Automation finished successfully. Total fields processed: ${fieldsProcessedTotal}.`;

    } catch (error) {
        console.error('Automation error:', error);
        if (browser) await browser.close();
        throw new Error(`AI Automation failed: ${error.message}`);
    }
}


// --- API Endpoint ---
app.post('/automate', async (req, res) => {
    const { url } = req.body; 
    
    // 💡 GENERATE UNIQUE DATA HERE:
    const uniqueApplicationData = generateRandomData(); 

    if (!url) {
        return res.status(400).json({ error: 'Missing URL in request body.' });
    }
    
    try {
        // Pass the GENERATED data to the automation function
        const result = await automateForm(url, uniqueApplicationData);
        res.json({ message: result, data_used: uniqueApplicationData }); 
    } catch (error) {
        console.error(error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ AI Automation Server running on http://localhost:${PORT}`);
});