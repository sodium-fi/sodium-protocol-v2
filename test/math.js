// TODO: maybe change rounding to down rounding,
// TODO: because it can work wrong with principal like 1999
function calculateInterestAndFee (
	principal,
	APR,
	duration,
	feeInBasisPoints
) {
	const yeildPerYear = Math.round(Math.round(principal * APR) / 10000);
	const baseInterest = Math.round(Math.round(yeildPerYear * duration) / 31536000);
	const baseFee = Math.round(Math.round(baseInterest * feeInBasisPoints) / 10000);

	const baseInterestMinusBaseFee = baseInterest - baseFee;
	const doubleBaseFee = baseFee * 2;

	return {
		baseInterestMinusBaseFee,
		doubleBaseFee
	};
}

function principalPlusInterest (
	principal,
	APR,
	duration
) {
	const yeildPerYear = Math.round(Math.round(principal * APR) / 10000);
	const interest = Math.round(Math.round(yeildPerYear * duration) / 31536000);

	return principal + interest;
}

function partialPaymentParameters (
	principal,
	APR,
	duration,
	feeInBasisPoints
) {
	const oneYearInterest = Math.round(Math.round(principal * APR) / 10000);
	const baseInterest = Math.round(Math.round(oneYearInterest * duration) / 31536000);

	const principalReduction = principal - baseInterest;
	const absoluteProtocolFee = (baseInterest * feeInBasisPoints) / 10000;

	const interestMinusFee = baseInterest - absoluteProtocolFee;
	const reductionMinusFee = principalReduction - absoluteProtocolFee;

	const doubleBaseFee = absoluteProtocolFee * 2;

	return { reductionMinusFee, interestMinusFee, doubleBaseFee };
}

module.exports = {
	calculateInterestAndFee,
	partialPaymentParameters,
	principalPlusInterest
};
