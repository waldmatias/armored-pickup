function shorterAddress(longAddress) {
    return longAddress[0] + "..." + longAddress.substring(longAddress.length -4)
}


function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { shorterAddress, wait };