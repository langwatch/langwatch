# LangWatch Enterprise License

Copyright (c) 2024-2026 LangWatch (Reasoning Engine B.V.)

This license governs the files in this directory and its subdirectories (the
"Enterprise Software"). The rest of the repository is licensed separately, see
the repository root `LICENSE.md` and `NOTICE`.

The Enterprise Software implements the enterprise capabilities of LangWatch,
including single sign-on, SCIM provisioning, audit logging, licensing, billing,
and back-office tooling. The enterprise capabilities are the surfaces the
software enables only for licensed deployments; each verifies a license at
runtime before it can be used.

Some of them keep recording in the background on an unlicensed deployment so
that no history is lost, audit logging in particular. Reading, exporting, or
otherwise making use of what they record is the enterprise capability, and
that is what a license is required for.

## Grants

1. **Running LangWatch.** You may run the Enterprise Software in production as
   part of a LangWatch distribution, provided the license verification and the
   runtime checks that gate the enterprise capabilities remain intact. You do
   not need a commercial license for this: without one the enterprise
   capabilities cannot be used, and the rest of LangWatch is yours to use under
   its own license.

2. **Enterprise capabilities.** Enabling or using an enterprise capability in
   production requires a valid LangWatch Enterprise License genuinely issued by
   LangWatch, available at https://langwatch.ai/pricing or by contacting
   sales@langwatch.ai. The license key you receive is what the runtime checks
   verify. A key that passes verification only because the verification key it
   is checked against was replaced or altered is not a license under this
   agreement, and using an enterprise capability on that basis is not granted
   by section 1.

3. **Development, evaluation, and testing.** You may copy, modify, and use the
   Enterprise Software for non-production purposes, including local
   development, internal evaluation, and writing or running automated tests,
   without holding an Enterprise License.

4. **Patches and contributions.** You may modify the Enterprise Software and
   publish patches. By submitting a Contribution to this directory you agree
   that LangWatch (Reasoning Engine B.V.) retains all rights to those
   modifications and patches, and that the exploitation of any such
   modifications in production requires a valid LangWatch Enterprise License.

## Conditions

The grant in section 1 does not extend to a distribution in which the license
verification or the runtime checks that gate the enterprise capabilities have
been removed, disabled, or circumvented, whether that change was made inside
this directory or elsewhere. Running the Enterprise Software as part of such a
distribution in production is not licensed.

Without limiting the foregoing, it is forbidden to copy, merge, publish,
distribute, sublicense, and/or sell the Enterprise Software for production use
outside of a LangWatch distribution, or to offer the enterprise capabilities
to third parties as a service, without a valid Enterprise License.

The above copyright notice and this license notice shall be included in all
copies or substantial portions of the Enterprise Software.

Third-party components incorporated by the Enterprise Software retain their
original licenses, granted by their respective copyright holders.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
