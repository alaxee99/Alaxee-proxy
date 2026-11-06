# Microsoft Edge Add-ons distribution

## What can be automated

- GitHub Actions runs tests and creates the clean Edge package.
- After the first store listing exists, a version tag (`vX.Y.Z`) runs the Microsoft Edge Add-ons Update REST API workflow.
- The workflow uploads the new package and submits the draft for certification.
- Microsoft performs certification and controls the store rollout. After publication, Edge users who installed the store listing receive updates through Edge's normal store update mechanism.

## What must happen manually once

1. Register for the Microsoft Edge developer program through Partner Center. Microsoft currently documents no registration fee.
2. Create the first Alaxee Proxy product/submission in Partner Center. Microsoft's Update REST API cannot create a new product or update listing metadata; the initial listing and store details must be completed in Partner Center.
3. Provide the required listing assets and accurate privacy/permission/data-use disclosures. The current extension asks for `proxy`, `storage`, and `activeTab`; explain that these powers are used only to control Edge's proxy configuration, save local preferences, and read the current tab's hostname after the user invokes the extension.
4. Complete Microsoft's initial certification and wait until the listing is in the store.
5. In Partner Center, open **Microsoft Edge → Publish API**, enable the new API experience, and create API credentials. Use the v1.1 API key flow.
6. Copy the product GUID from the extension overview page.
7. Add these GitHub Actions repository secrets (never put credentials in source files):
   - `EDGE_ADDONS_PRODUCT_ID`
   - `EDGE_ADDONS_CLIENT_ID`
   - `EDGE_ADDONS_API_KEY`

## Routine release

1. Update `manifest.json` version and `package.json` version together.
2. Run `npm test`, `npm run check`, and `python scripts/package-extension.py`.
3. Commit and push the change to `main`.
4. Create and push a matching tag, for example `v0.1.3`.
5. GitHub Actions validates the tag/version match, reruns checks, packages only runtime files, uploads the package, and submits it to Microsoft for certification.
6. Check the workflow result and Partner Center status. A successful API submission is **not** the same as Microsoft certification or store publication.

The Edge Add-ons API supports package upload, operation-status checks, submission publishing, and publish-status checks. The first product creation and listing metadata remain manual Partner Center steps.

## Security

- Keep all Microsoft API credentials in GitHub Actions secrets.
- Do not paste API keys into issues, commits, chat, or the extension itself.
- Rotate an API key in Partner Center if it is exposed.
- Do not tag a release until its code and tests are ready. Pushing a `v*` tag is the release/publish trigger.
