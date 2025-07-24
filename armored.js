const { rpc: SorobanRpc, Horizon, Operation, Asset, Networks, TransactionBuilder, StrKey, Memo, Keypair } = require('@stellar/stellar-sdk');
const { shorterAddress } = require('./utils');
const config = require('./config.armored.json');
const rpc = new SorobanRpc.Server(config.stellar?.rpc, { allowHttp: true });
const horizon = new Horizon.Server(config.stellar?.horizon, { allowHttp: true });
const fees = config.stellar?.fees || 10000000;

const { address: vault, memo } = config.vault;
const { assetCode: code, assetIssuer: issuer, networkPassphrase, debug } = config.stellar;

const signers = config.farmers.reduce((acc, farmer) => {
    const publicKey = farmer.secret != null ? Keypair.fromSecret(farmer.secret).publicKey() : farmer.address;
    
    acc[publicKey] = {
        secret: farmer.secret,
    };

    return acc;
}, {});

const responseWaitTime = 2000; 
async function getResponse(response) {
    const txId = response.hash;

    while (response.status === "PENDING" || response.status === "NOT_FOUND") {
        await new Promise(resolve => setTimeout(resolve, responseWaitTime));
        response = await rpc.getTransaction(txId);
    }

    if (config.stellar?.debug) {
        console.log(response);
    }
    response.feeCharged = (response.feeCharged || response.resultXdr?._attributes?.feeCharged || 0).toString();

    return response;
}

async function vaultStats() {
    const vaultAccount = await horizon.loadAccount(vault);
    vaultAccount.balances.forEach(balance => console.log(`${shorterAddress(vault)}, asset: ${balance.asset_code}, amount: ${balance.balance}`));
}

async function transport() {
    if (code?.length && StrKey.isValidEd25519PublicKey(vault) && StrKey.isValidEd25519PublicKey(issuer)) {
        let builder;
        let totalTransferAmount = 0;

        await vaultStats();
        
        for (const key in signers) {
            const account = await horizon.loadAccount(key);

            const transferAmount = Number(account.balances.find(balance => balance.asset_code === code && balance.asset_issuer === issuer)?.balance || 0);
            if (transferAmount === 0) {
                console.log(`Nothing to transfer.`)
                continue;
            } else {
                totalTransferAmount += transferAmount;
            }
            
            builder ??= new TransactionBuilder(
                account, 
                { fee: fees.toString(), networkPassphrase: networkPassphrase || Networks.PUBLIC }
            );


            console.log(`Transfer from ${account.accountId()} to ${vault}, ${transferAmount} of ${code}`);
            
            builder.addOperation(Operation.payment({
                destination: vault, 
                asset: new Asset(code, issuer),
                amount: transferAmount.toString(), // cannot be 0
                source: key 
            }));
        }

        // check if builder has operations otherwise just end
        if (totalTransferAmount == 0) {
            console.log(`No operations in tx`);
            return;
        }

        if (memo) {
            builder.addMemo(Memo.text(memo))
        }

        const transaction = builder.setTimeout(300).build();
        Object.values(signers).forEach(s => transaction.sign(Keypair.fromSecret(s.secret)));

        if (debug) console.log(transaction.toEnvelope().toXDR('base64'));

        //
        const response = await getResponse(await rpc.sendTransaction(transaction));
        const hash = transaction.hash().toString('hex');
        if (debug) console.log(response);

        if (response.status !== 'SUCCESS') {
            console.log(`Error. TX Failed: ${hash}`);
        } else {
            console.log(`Transport succeeded.`);
            vaultStats(vault);
        }
        //

    }
}

// using path payments
async function convert(fromAsset, toAsset) {
    
}

transport();