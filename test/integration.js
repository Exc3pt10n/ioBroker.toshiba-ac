const path = require('node:path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');

// Startet den Adapter in einer echten js-controller-Testinstanz (ohne Zugangsdaten, also ohne Cloud-Zugriff)
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Start ohne Zugangsdaten', getHarness => {
            it('startet, legt die Instanz-Objekte an und meldet keine Verbindung', async function () {
                this.timeout(60000);
                const harness = getHarness();
                await harness.startAdapterAndWait();
                const connection = await harness.states.getStateAsync('toshiba-ac.0.info.connection');
                expect(connection, 'info.connection').to.exist;
                expect(connection.val).to.equal(false);
                const clientId = await harness.objects.getObjectAsync('toshiba-ac.0.info.clientId');
                expect(clientId, 'info.clientId').to.exist;
            });
        });
    },
});
