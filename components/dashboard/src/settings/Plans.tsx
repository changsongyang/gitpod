/**
 * Copyright (c) 2021 Gitpod GmbH. All rights reserved.
 * Licensed under the GNU Affero General Public License (AGPL).
 * See License-AGPL.txt in the project root for license information.
 */

import { useState, useEffect, useContext } from "react";
import { countries } from 'countries-list';
import { AccountStatement, Subscription, UserPaidSubscription, AssignedTeamSubscription } from "@gitpod/gitpod-protocol/lib/accounting-protocol";
import { PlanCoupon, GithubUpgradeURL } from "@gitpod/gitpod-protocol/lib/payment-protocol";
import { Plans, Plan } from "@gitpod/gitpod-protocol/lib/plans";
import SelectableCard from "../components/SelectableCard";
import { getGitpodService } from "../service/service";
import { UserContext } from "../user-context";
import { SettingsPage } from "./SettingsPage";

type PlanWithOriginalPrice = Plan & { originalPrice?: number };

export default function () {
    const { user } = useContext(UserContext);
    const { server } = getGitpodService();
    const [ accountStatement, setAccountStatement ] = useState<AccountStatement>();
    const [ showPaymentUI, setShowPaymentUI ] = useState<boolean>();
    const [ isChargebeeCustomer, setIsChargebeeCustomer ] = useState<boolean>();
    const [ isStudent, setIsStudent ] = useState<boolean>();
    const [ clientRegion, setClientRegion ] = useState<string>();
    const [ availableCoupons, setAvailableCoupons ] = useState<PlanCoupon[]>();
    const [ appliedCoupons, setAppliedCoupons ] = useState<PlanCoupon[]>();
    const [ gitHubUpgradeUrls, setGitHubUpgradeUrls ] = useState<GithubUpgradeURL[]>();
    const [ privateRepoTrialEndDate, setPrivateRepoTrialEndDate ] = useState<string>();

    useEffect(() => {
        Promise.all([
            server.getAccountStatement({}).then(v => () => setAccountStatement(v)),
            server.getShowPaymentUI().then(v => () => setShowPaymentUI(v)),
            server.isChargebeeCustomer().then(v => () => setIsChargebeeCustomer(v)),
            server.isStudent().then(v => () => setIsStudent(v)),
            server.getClientRegion().then(v => () => setClientRegion(v)),
            server.getAvailableCoupons().then(v => () => setAvailableCoupons(v)),
            server.getAppliedCoupons().then(v => () => setAppliedCoupons(v)),
            server.getGithubUpgradeUrls().then(v => () => setGitHubUpgradeUrls(v)),
            server.getPrivateRepoTrialEndDate().then(v => () => setPrivateRepoTrialEndDate(v)),
        ]).then(setters => setters.forEach(s => s()));
    }, []);

    console.log('accountStatement', accountStatement);
    console.log('showPaymentUI', showPaymentUI);
    console.log('isChargebeeCustomer', isChargebeeCustomer);
    console.log('isStudent', isStudent);
    console.log('clientRegion', clientRegion);
    console.log('availableCoupons', availableCoupons);
    console.log('appliedCoupons', appliedCoupons);
    console.log('gitHubUpgradeUrls', gitHubUpgradeUrls);
    console.log('privateRepoTrialEndDate', privateRepoTrialEndDate);

    const activeSubscriptions = (accountStatement?.subscriptions || []).filter(s => Subscription.isActive(s, now()));
    const freeSubscription =
        activeSubscriptions.find(s => s.planId === Plans.FREE_OPEN_SOURCE.chargebeeId) // Prefer Pro Open Source plan
        || activeSubscriptions.find(s => Plans.isFreePlan(s.planId)); // Any active free plan
    const freePlan = freeSubscription && Plans.getById(freeSubscription.planId) || Plans.getFreePlan(user?.creationDate || now());
    const paidSubscription = activeSubscriptions.find(s => UserPaidSubscription.is(s));
    const paidPlan = paidSubscription && Plans.getById(paidSubscription.planId);
    const assignedTeamSubscriptions = activeSubscriptions.filter(s => AssignedTeamSubscription.is(s));
    console.log('assignedTeamSubscriptions', assignedTeamSubscriptions);

    // @ts-ignore
    const currency = (paidPlan && paidPlan.currency) || (countries[clientRegion]?.currency === 'EUR' ? 'EUR' : 'USD');
    const personalPlan = Plans.getPersonalPlan(currency);
    const professionalPlan = Plans.getNewProPlan(currency);
    const unleashedPlan = Plans.getProPlan(currency);

    const planCards = [];

    // Plan card: Open Source (or Professional Open Source)
    const openSourceFeatures = <>
        <p className="truncate">✓ Public Repositories</p>
        <p className="truncate">✓ 4 Parallel Workspaces</p>
        <p className="truncate">✓ 30 min Timeout</p>
    </>;
    planCards.push(<PlanCard plan={freePlan} selected={!paidPlan}>{openSourceFeatures}</PlanCard>);

    // Plan card: Personal
    const personalFeatures = <>
        <p className="truncate">← Everything in Free</p>
        <p className="truncate">✓ Private Repositories</p>
    </>;
    if (paidPlan?.chargebeeId === personalPlan.chargebeeId) {
        planCards.push(<PlanCard plan={applyCoupon(personalPlan, appliedCoupons)} selected={true}>{personalFeatures}</PlanCard>);
    } else {
        planCards.push(<PlanCard plan={applyCoupon(personalPlan, availableCoupons)} selected={false}>{personalFeatures}</PlanCard>);
    }

    // Plan card: Professional
    const professionalFeatures = <>
        <p className="truncate">← Everything in Personal</p>
        <p className="truncate">✓ 8 Parallel Workspaces</p>
        <p className="truncate">✓ Teams</p>
    </>;
    if (paidPlan?.chargebeeId === professionalPlan.chargebeeId) {
        planCards.push(<PlanCard plan={applyCoupon(professionalPlan, appliedCoupons)} selected={true}>{professionalFeatures}</PlanCard>);
    } else {
        planCards.push(<PlanCard plan={applyCoupon(professionalPlan, availableCoupons)} selected={false}>{professionalFeatures}</PlanCard>);
    }

    // Plan card: Unleashed
    const unleashedFeatures = <>
        <p className="truncate">← Everything in Professional</p>
        <p className="truncate">✓ 16 Parallel Workspaces</p>
        <p className="truncate">✓ 1h Timeout</p>
        <p className="truncate">✓ 3h Timeout Boost</p>
    </>;
    if (paidPlan?.chargebeeId === unleashedPlan.chargebeeId) {
        planCards.push(<PlanCard plan={applyCoupon(unleashedPlan, appliedCoupons)} selected={true}>{unleashedFeatures}</PlanCard>);
    } else {
        planCards.push(<PlanCard plan={applyCoupon(unleashedPlan, availableCoupons)} selected={false}>{unleashedFeatures}</PlanCard>);
    }

    return <div>
        <SettingsPage title='Plans' subtitle='Manage account usage and billing.'>
            <div className="w-full text-center">
                <p className="text-xl font-medium text-gray-500">You are currently using the {paidPlan ? paidPlan.name : freePlan.name} plan.</p>
                <p className="text-base">Upgrade your plan to get access to private repositories or more parallel workspaces.</p>
                <p className="m-3">Remaining hours: {accountStatement?.remainingHours}</p>
                <p className="text-sm"><a className="text-blue-light" href="#">Billing</a></p>
            </div>
            <div className="mt-4 flex space-x-2">{planCards}</div>
        </SettingsPage>
    </div>;
}

interface PlanCardProps {
  plan: PlanWithOriginalPrice;
  selected: boolean;
  children: React.ReactNode;
}

function PlanCard(p: PlanCardProps) {
    return <SelectableCard className="w-52" title={p.plan.name.toUpperCase()} selected={p.selected} onClick={() => {}}>
        <div className="mt-5 mb-5 flex flex-col items-center justify-center">
            <p className="text-3xl text-gray-500 font-bold">{p.plan.hoursPerMonth === 'unlimited' ? '∞' : p.plan.hoursPerMonth}</p>
            <p className="text-base text-gray-500 font-bold">hours</p>
        </div>
        <div className="flex-grow flex flex-col space-y-2">{p.children}</div>
        <div>
        <p className="text-center text-gray-500 font-semibold mb-2 mt-4">{p.plan.pricePerMonth <= 0.001
            ? 'FREE'
            : (p.plan.currency === 'EUR' ? '€' : '$') + p.plan.pricePerMonth + ' per month'
        }</p>
        {p.selected
            ? <button className="w-full">Current Plan</button>
            : <button className="w-full border-green-600 text-green-600 bg-white hover:border-green-800 hover:text-green-800">Upgrade</button>}
        </div>
    </SelectableCard>;
}

function applyCoupon(plan: Plan, coupons: PlanCoupon[] | undefined): PlanWithOriginalPrice {
    let coupon = (coupons || []).find(c => c.chargebeePlanID == plan.chargebeeId);
    if (!coupon) {
        return plan;
    }
    return {
        ...plan,
        pricePerMonth: coupon.newPrice || 0,
        originalPrice: plan.pricePerMonth
    }
}

function now() {
    return new Date().toISOString();
}
